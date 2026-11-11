#!/usr/bin/env python3
"""Roland QUAD-CAPTURE (0582:012f) control daemon and CLI.

The daemon keeps the control channel (MIDI cable 1) open at all times, which
is what stops the front panel from freezing, and answers state queries over a
Unix socket.  The CLI talks to that socket.
"""

import argparse
import ctypes
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time

VENDOR = 0x0582
PRODUCT = 0x012F
SOCKET_PATH = "/run/qcctl.sock"

SYSEX_HDR = bytes([0xF0, 0x41, 0x10, 0x00, 0x00, 0x56])
STATE_ADDR = bytes([0x01, 0x00, 0x00, 0x00])
STATE_SIZE = 59
METER_ADDR = bytes([0x00, 0x0A, 0x00, 0x01])
RATES = (44100, 48000, 96000, 192000)


def checksum(payload):
    return (128 - (sum(payload) & 0x7F)) & 0x7F


def sysex_dt1(addr, data):
    body = bytes(addr) + bytes(data)
    return SYSEX_HDR + b"\x12" + body + bytes([checksum(body)]) + b"\xf7"


def sysex_rq1(addr, size):
    body = bytes(addr) + size.to_bytes(4, "big")
    return SYSEX_HDR + b"\x11" + body + bytes([checksum(body)]) + b"\xf7"


def find_card():
    for i in range(32):
        path = f"/proc/asound/card{i}/usbid"
        try:
            with open(path) as f:
                if f.read().strip() == "0582:012f":
                    return i
        except OSError:
            continue
    return None


class RawMidi:
    def __init__(self, name):
        self.lib = ctypes.CDLL("libasound.so.2")
        self.lib.snd_rawmidi_open.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_char_p,
            ctypes.c_int,
        ]
        self.lib.snd_rawmidi_open.restype = ctypes.c_int
        self.lib.snd_rawmidi_read.argtypes = [
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
        self.lib.snd_rawmidi_read.restype = ctypes.c_ssize_t
        self.lib.snd_rawmidi_write.argtypes = [
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
        self.lib.snd_rawmidi_write.restype = ctypes.c_ssize_t
        self.lib.snd_rawmidi_close.argtypes = [ctypes.c_void_p]
        self.lib.snd_rawmidi_close.restype = ctypes.c_int

        inp = ctypes.c_void_p()
        out = ctypes.c_void_p()
        err = self.lib.snd_rawmidi_open(
            ctypes.byref(inp), ctypes.byref(out), name.encode(), 0)
        if err < 0:
            raise OSError(-err, f"snd_rawmidi_open({name})")
        self.inp = inp
        self.out = out

    def read(self, size=4096):
        buf = ctypes.create_string_buffer(size)
        n = self.lib.snd_rawmidi_read(self.inp, buf, size)
        if n < 0:
            raise OSError(-n, "snd_rawmidi_read")
        return buf.raw[:n]

    def write(self, data):
        buf = ctypes.create_string_buffer(bytes(data), len(data))
        n = self.lib.snd_rawmidi_write(self.out, buf, len(data))
        if n < 0:
            raise OSError(-n, "snd_rawmidi_write")
        return n

    def close(self):
        self.lib.snd_rawmidi_close(self.inp)
        self.lib.snd_rawmidi_close(self.out)


PARAMS = {
    "lowcut1": (bytes([0x00, 0x05, 0x00, 0x01]), 0, 1),
    "lowcut2": (bytes([0x00, 0x05, 0x01, 0x01]), 0, 1),
    "phase1": (bytes([0x00, 0x05, 0x00, 0x02]), 0, 1),
    "phase2": (bytes([0x00, 0x05, 0x01, 0x02]), 0, 1),
    "sens1": (bytes([0x00, 0x05, 0x00, 0x04]), 0, 108),
    "sens2": (bytes([0x00, 0x05, 0x01, 0x04]), 0, 108),
    "link": (bytes([0x00, 0x05, 0x00, 0x05]), 0, 1),
    "comp1": (bytes([0x00, 0x05, 0x00, 0x06]), 0, 1),
    "comp2": (bytes([0x00, 0x05, 0x01, 0x06]), 0, 1),
    "gate1": (bytes([0x00, 0x05, 0x00, 0x07]), 0, 50),
    "gate2": (bytes([0x00, 0x05, 0x01, 0x07]), 0, 50),
    "attack1": (bytes([0x00, 0x05, 0x00, 0x08]), 0, 25),
    "attack2": (bytes([0x00, 0x05, 0x01, 0x08]), 0, 25),
    "release1": (bytes([0x00, 0x05, 0x00, 0x09]), 0, 45),
    "release2": (bytes([0x00, 0x05, 0x01, 0x09]), 0, 45),
    "threshold1": (bytes([0x00, 0x05, 0x00, 0x0A]), 0, 50),
    "threshold2": (bytes([0x00, 0x05, 0x01, 0x0A]), 0, 50),
    "ratio1": (bytes([0x00, 0x05, 0x00, 0x0B]), 0, 8),
    "ratio2": (bytes([0x00, 0x05, 0x01, 0x0B]), 0, 8),
    "gain1": (bytes([0x00, 0x05, 0x00, 0x0C]), 0, 74),
    "gain2": (bytes([0x00, 0x05, 0x01, 0x0C]), 0, 74),
    "output_select": (bytes([0x00, 0x03, 0x00, 0x00]), 0, 127),
    "digital_in": (bytes([0x00, 0x02, 0x00, 0x04]), 0, 127),
    "autosens_mode": (bytes([0x00, 0x02, 0x01, 0x00]), 0, 127),
    "autosens_margin": (bytes([0x00, 0x02, 0x01, 0x01]), 0, 127),
    "autosens": (bytes([0x00, 0x02, 0x01, 0x02]), 0, 2),
    "meter": (bytes([0x00, 0x0A, 0x00, 0x00]), 0, 1),
}

MIXER = {
    "mix1": bytes([0x00, 0x06, 0x00, 0x08]),
    "mix2": bytes([0x00, 0x06, 0x01, 0x08]),
    "mix3": bytes([0x00, 0x06, 0x02, 0x08]),
}

# address byte 3 -> (state block index, is a bit field)
PARAM_STATE = {
    0x01: (23, True),   # LO-CUT
    0x02: (24, True),   # PHASE
    0x04: (25, False),  # SENS
    0x05: (27, True),   # stereo link
    0x06: (28, True),   # compressor
    0x07: (29, False),  # gate
    0x08: (31, False),  # attack
    0x09: (33, False),  # release
    0x0A: (35, False),  # threshold
    0x0B: (37, False),  # ratio
    0x0C: (39, False),  # gain
}


def nibbles_to_int(data):
    value = 0
    for b in data:
        value = (value << 4) | (b & 0x0F)
    return value


def int_to_nibbles(value, count=6):
    return bytes([(value >> (4 * (count - 1 - i))) & 0x0F for i in range(count)])


class Daemon:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = None
        self.meters = None
        self.clock = {"rate": None, "external": None, "locked": None}
        self.pending = None
        self.pending_evt = threading.Event()
        self.state_evt = threading.Event()
        self.pending_read_addr = None
        self.pending_read_data = None
        self.pending_read_evt = threading.Event()
        self.running = True
        self.midi = None

    # -- MIDI -----------------------------------------------------------
    def open_midi(self):
        card = find_card()
        if card is None:
            return False
        name = f"hw:{card},0,1"
        try:
            self.midi = RawMidi(name)
        except OSError as exc:
            print(f"qcctl: cannot open {name}: {exc}", file=sys.stderr)
            return False
        print(f"qcctl: control channel open on {name}", file=sys.stderr)
        return True

    def reader(self):
        buf = b""
        while self.running:
            if self.midi is None:
                time.sleep(1)
                self.open_midi()
                continue
            try:
                data = self.midi.read()
            except OSError:
                time.sleep(1)
                try:
                    self.midi.close()
                except OSError:
                    pass
                self.midi = None
                continue
            if not data:
                continue
            buf += data
            while b"\xf7" in buf:
                end = buf.index(b"\xf7") + 1
                msg, buf = buf[:end], buf[end:]
                if msg.startswith(b"\xf0"):
                    self.handle_message(msg)

    def handle_message(self, msg):
        if len(msg) < 13 or msg[6] != 0x12:
            return
        addr = msg[7:11]
        data = msg[11:-2]
        with self.lock:
            if addr == STATE_ADDR and len(data) == STATE_SIZE:
                self.state = bytearray(data)
                self.state_evt.set()
            elif (addr[0:2] == b"\x00\x05" and addr[3] in PARAM_STATE
                  and len(data) == 1 and self.state is not None):
                ch = addr[2]
                if ch > 1:
                    return
                index, is_bit = PARAM_STATE[addr[3]]
                if addr[3] == 0x05:
                    self.state[27] = data[0] & 1
                elif is_bit:
                    if data[0]:
                        self.state[index] |= 1 << ch
                    else:
                        self.state[index] &= ~(1 << ch) & 0xFF
                else:
                    self.state[index + ch] = data[0]
            elif addr == METER_ADDR and len(data) == 16:
                self.meters = [
                    ((data[2 * i] & 0x7F) << 7) | (data[2 * i + 1] & 0x7F)
                    for i in range(8)
                ]
            if (self.pending_read_addr is not None
                    and bytes(addr) == self.pending_read_addr):
                self.pending_read_data = bytes(data)
                self.pending_read_addr = None
                self.pending_read_evt.set()
            if self.pending == msg:
                self.pending = None
                self.pending_evt.set()

    def send(self, msg, wait_echo=True):
        with self.lock:
            if self.midi is None:
                raise OSError("control channel is not open")
            self.pending = msg
            self.pending_evt.clear()
            self.midi.write(msg)
        if wait_echo:
            self.pending_evt.wait(0.4)
        with self.lock:
            self.pending = None

    def request_state(self):
        try:
            self.send(sysex_rq1(STATE_ADDR, STATE_SIZE), wait_echo=False)
        except OSError:
            pass

    def sync_state(self, timeout=0.6):
        self.state_evt.clear()
        self.request_state()
        self.state_evt.wait(timeout)

    def read_addr(self, addr, size=1, timeout=0.8):
        with self.lock:
            self.pending_read_addr = bytes(addr)
            self.pending_read_data = None
            self.pending_read_evt.clear()
        try:
            self.send(sysex_rq1(addr, size), wait_echo=False)
        except OSError:
            with self.lock:
                self.pending_read_addr = None
            return None
        self.pending_read_evt.wait(timeout)
        with self.lock:
            data = self.pending_read_data
            self.pending_read_addr = None
        return data

    # -- clock status (interface 3) -------------------------------------
    def clock_loop(self):
        try:
            import usb.core
            import usb.util
        except ImportError:
            print("qcctl: pyusb not installed, clock status disabled",
                  file=sys.stderr)
            return

        dev = None
        while self.running:
            if dev is None:
                dev = usb.core.find(idVendor=VENDOR, idProduct=PRODUCT)
                if dev is None:
                    time.sleep(2)
                    continue
                try:
                    usb.util.claim_interface(dev, 3)
                    dev.set_interface_altsetting(
                        interface=3, alternate_setting=1)
                except Exception:
                    try:
                        usb.util.release_interface(dev, 3)
                    except Exception:
                        pass
                    dev = None
                    time.sleep(2)
                    continue
            try:
                data = bytes(dev.read(0x82, 8, timeout=1500))
                rate = data[3] | (data[4] << 8) | (data[5] << 16)
                with self.lock:
                    self.clock = {
                        "rate": rate,
                        "external": bool(data[6]),
                        "locked": bool(data[7]),
                    }
            except Exception:
                try:
                    dev.set_interface_altsetting(
                        interface=3, alternate_setting=0)
                    usb.util.release_interface(dev, 3)
                except Exception:
                    pass
                dev = None
                time.sleep(1)
                continue
            time.sleep(1)

    def poll_loop(self):
        while self.running:
            self.request_state()
            time.sleep(1.0)

    # -- sample rate ----------------------------------------------------
    def _card_index(self):
        try:
            with open("/proc/asound/cards") as f:
                for line in f:
                    if "QUAD-CAPTURE" in line or "QUADCAPTURE" in line:
                        return int(line.split()[0])
        except (OSError, ValueError):
            pass
        return None

    def _pcm_idle(self):
        card = self._card_index()
        if card is None:
            return False
        for pcm in (f"/proc/asound/card{card}/pcm0p/sub0/status",
                    f"/proc/asound/card{card}/pcm0c/sub0/status"):
            try:
                with open(pcm) as f:
                    if f.read().split()[0] != "closed":
                        return False
            except (OSError, IndexError):
                continue
        return True

    @staticmethod
    def _pipewire_env():
        exe = shutil.which("pw-metadata")
        if not exe:
            return None
        for path in sorted(glob.glob("/run/user/*/pipewire-0")):
            uid = path.split("/")[3]
            if uid.isdigit() and int(uid) != 0:
                env = dict(os.environ)
                env["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"
                return exe, env
        return None

    def _set_pipewire_rate(self, hz):
        pw = self._pipewire_env()
        if not pw:
            return False
        exe, env = pw
        try:
            subprocess.run(
                [exe, "-n", "settings", "0", "clock.allowed-rates",
                 "[ 44100 48000 96000 192000 ]"],
                env=env, check=True, timeout=5,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(
                [exe, "-n", "settings", "0", "clock.force-rate", str(hz)],
                env=env, check=True, timeout=5,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except (OSError, subprocess.SubprocessError):
            return False

    def _vendor_set_rate(self, hz):
        try:
            import usb.core
        except ImportError:
            return False
        dev = usb.core.find(idVendor=VENDOR, idProduct=PRODUCT)
        if dev is None:
            return False
        data = bytes([0x40, hz & 0xFF, (hz >> 8) & 0xFF, (hz >> 16) & 0xFF])
        try:
            dev.ctrl_transfer(0x40, 3, 8, 0, data, timeout=1000)
            back = bytes(dev.ctrl_transfer(0xC0, 3, 1, 0, 4, timeout=1000))
        except Exception:
            return False
        return (len(back) == 4
                and (back[0] | (back[1] << 8) | (back[2] << 16)) == hz)

    def set_rate(self, hz):
        if hz not in RATES:
            return {"error": "rate must be 44100, 48000, 96000 or 192000"}
        sources = []
        if self._set_pipewire_rate(hz):
            sources.append("pipewire")
        if self._pcm_idle() and self._vendor_set_rate(hz):
            sources.append("vendor")
        deadline = time.monotonic() + 4.0
        while time.monotonic() < deadline:
            with self.lock:
                rate = self.clock.get("rate")
            if rate == hz:
                return {"ok": True, "rate": hz, "sources": sources}
            time.sleep(0.1)
        with self.lock:
            rate = self.clock.get("rate")
        if not sources:
            return {"error": "no PipeWire and PCM is busy; cannot change "
                             "the rate", "rate": rate}
        return {"ok": False, "error": "device clock did not follow",
                "rate": rate, "sources": sources}

    # -- socket ---------------------------------------------------------
    def status(self):
        with self.lock:
            state = self.state
            meters = self.meters
            clock = dict(self.clock)
        result = {"clock": clock, "meters": meters, "state": None}
        if state is not None:
            result["state"] = {
                "raw": state.hex(" "),
                "autosens_margin": state[20],
                "autosens": state[21],
                "output_select": state[22],
                "lowcut": {"in1": bool(state[23] & 1),
                           "in2": bool(state[23] & 2)},
                "phase": {"in1": bool(state[24] & 1),
                          "in2": bool(state[24] & 2)},
                "sens": {"in1": state[25], "in2": state[26]},
                "link": bool(state[27] & 1),
                "comp": {"in1": bool(state[28] & 1),
                         "in2": bool(state[28] & 2)},
                "gate": {"in1": state[29], "in2": state[30]},
                "attack": {"in1": state[31], "in2": state[32]},
                "release": {"in1": state[33], "in2": state[34]},
                "threshold": {"in1": state[35], "in2": state[36]},
                "ratio": {"in1": state[37], "in2": state[38]},
                "gain": {"in1": state[39], "in2": state[40]},
                "mix": {
                    "in1": nibbles_to_int(state[41:47]),
                    "in2": nibbles_to_int(state[47:53]),
                    "coax": nibbles_to_int(state[53:59]),
                },
            }
        return result

    def handle_request(self, req):
        cmd = req.get("cmd")
        if cmd == "status":
            return self.status()
        if cmd == "set":
            addr = bytes.fromhex(req["addr"])
            data = bytes.fromhex(req["data"])
            self.send(sysex_dt1(addr, data))
            self.sync_state()
            return {"ok": True}
        if cmd == "param":
            name = req["name"]
            value = int(req["value"])
            if name in PARAMS:
                addr, lo, hi = PARAMS[name]
                if not lo <= value <= hi:
                    return {"error": f"value out of range {lo}..{hi}"}
                self.send(sysex_dt1(addr, [value]))
                self.sync_state()
                return {"ok": True}
            if name in MIXER:
                if not 0 <= value <= 0x7FFFFF:
                    return {"error": "value out of range 0..0x7fffff"}
                self.send(sysex_dt1(MIXER[name], int_to_nibbles(value)))
                self.sync_state()
                return {"ok": True}
            return {"error": f"unknown parameter {name}"}
        if cmd == "rate":
            return self.set_rate(int(req["value"]))
        if cmd == "read":
            addr = bytes.fromhex(req["addr"])
            data = self.read_addr(addr, int(req.get("size", 1)))
            if data is None:
                return {"error": "no response from device"}
            return {"ok": True, "data": data.hex(" ")}
        if cmd == "params":
            return {"params": sorted(list(PARAMS) + list(MIXER))}
        return {"error": f"unknown command {cmd}"}

    def serve(self):
        try:
            os.unlink(SOCKET_PATH)
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(SOCKET_PATH)
        os.chmod(SOCKET_PATH, 0o666)
        srv.listen(8)
        print(f"qcctl: listening on {SOCKET_PATH}", file=sys.stderr)
        while self.running:
            conn, _ = srv.accept()
            threading.Thread(target=self.client, args=(conn,),
                             daemon=True).start()

    def client(self, conn):
        try:
            f = conn.makefile("rwb")
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    req = json.loads(line)
                    resp = self.handle_request(req)
                except Exception as exc:
                    resp = {"error": str(exc)}
                f.write((json.dumps(resp) + "\n").encode())
                f.flush()
        except OSError:
            pass
        finally:
            conn.close()

    def run(self):
        self.open_midi()
        threading.Thread(target=self.reader, daemon=True).start()
        threading.Thread(target=self.clock_loop, daemon=True).start()
        threading.Thread(target=self.poll_loop, daemon=True).start()
        time.sleep(0.3)
        self.request_state()
        self.serve()


# -- CLI ------------------------------------------------------------------

def rpc(req, timeout=3.0):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    sock.connect(SOCKET_PATH)
    sock.sendall((json.dumps(req) + "\n").encode())
    f = sock.makefile("rb")
    line = f.readline()
    sock.close()
    return json.loads(line)


def format_status(st):
    lines = []
    clock = st.get("clock") or {}
    if clock.get("rate"):
        src = "external" if clock.get("external") else "internal"
        lock = "locked" if clock.get("locked") else "unlocked"
        lines.append(f"clock: {clock['rate']} Hz ({src}, {lock})")
    state = st.get("state")
    if not state:
        lines.append("state: not available")
        return "\n".join(lines)
    lines.append(f"autosens: state={state['autosens']} "
                 f"margin={state['autosens_margin']} dB")
    lines.append(f"output select: {state['output_select']}")
    for ch in ("in1", "in2"):
        lines.append(
            f"{ch}: sens={state['sens'][ch]} "
            f"lowcut={int(state['lowcut'][ch])} "
            f"phase={int(state['phase'][ch])} "
            f"comp={int(state['comp'][ch])} "
            f"gate={state['gate'][ch]} "
            f"attack={state['attack'][ch]} "
            f"release={state['release'][ch]} "
            f"threshold={state['threshold'][ch]} "
            f"ratio={state['ratio'][ch]} "
            f"gain={state['gain'][ch]}")
    lines.append(f"link: {int(state['link'])}")
    lines.append("mix: " + " ".join(
        f"{k}=0x{v:06x}" for k, v in state["mix"].items()))
    if st.get("meters"):
        lines.append("meters: " + " ".join(str(v) for v in st["meters"]))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(prog="qcctl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("daemon")
    sub.add_parser("status")
    sub.add_parser("params")
    p_set = sub.add_parser("set")
    p_set.add_argument("name")
    p_set.add_argument("value")
    p_mon = sub.add_parser("monitor")
    p_mon.add_argument("--interval", type=float, default=0.5)
    p_meter = sub.add_parser("meter")
    p_meter.add_argument("value", choices=["on", "off"])
    p_rate = sub.add_parser("rate")
    p_rate.add_argument("hz", type=int, choices=list(RATES))
    p_read = sub.add_parser("read")
    p_read.add_argument("addr", help="4-byte address, e.g. '00 02 00 04'")
    p_read.add_argument("size", nargs="?", type=int, default=1)
    args = ap.parse_args()

    if args.cmd == "daemon":
        Daemon().run()
        return

    try:
        if args.cmd == "status":
            print(format_status(rpc({"cmd": "status"})))
        elif args.cmd == "params":
            print("\n".join(rpc({"cmd": "params"})["params"]))
        elif args.cmd == "set":
            value = int(args.value, 0)
            resp = rpc({"cmd": "param", "name": args.name, "value": value})
            print(json.dumps(resp))
        elif args.cmd == "meter":
            resp = rpc({"cmd": "param", "name": "meter",
                        "value": 1 if args.value == "on" else 0})
            print(json.dumps(resp))
        elif args.cmd == "rate":
            resp = rpc({"cmd": "rate", "value": args.hz}, timeout=10)
            print(json.dumps(resp))
        elif args.cmd == "read":
            resp = rpc({"cmd": "read", "addr": args.addr,
                        "size": args.size}, timeout=5)
            print(json.dumps(resp))
        elif args.cmd == "monitor":
            last = None
            while True:
                st = rpc({"cmd": "status"})
                text = format_status(st)
                if text != last:
                    print(text)
                    print("-")
                    last = text
                time.sleep(args.interval)
    except (FileNotFoundError, ConnectionRefusedError):
        print("qcctl: daemon is not running (systemctl start qc-daemon)",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
