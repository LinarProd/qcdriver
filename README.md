# Roland QUAD-CAPTURE (0582:012f) для Linux

Патченный `snd-usb-audio` + демон управления + панель на Qt. Даёт все четыре
частоты дискретизации, доступ к панельному SysEx-каналу (cable 1), статус
клока и устраняет зависание панели.

Проверено на CachyOS, ядро `7.3.0-4-cachyos` (собрано clang). Исходники
модуля — `sound/usb` из Linux 7.3 с бэкпортом изменений для QUAD-CAPTURE,
которые есть только в более новых ядрах.

## Что умеет

| Возможность | Статус |
|---|---|
| Playback 44.1 / 48 / 96 / 192 кГц | OK (4/4/4/2 канала, S32_LE) |
| Capture 44.1 / 48 / 96 / 192 кГц | OK (6/6/6/2 канала) |
| Клок устройства следует за ALSA | OK, ~1.2 с на переключение |
| SysEx-канал панели | OK (`hw:<card>,0,1`, блок состояния 59 байт) |
| События панели (SENS, AUTO-SENS) | OK, DT1-поток на cable 1 |
| Статус клока (интерфейс 3, EP 0x82) | OK |
| Интерфейсы 3/4 свободны для userspace | OK |
| Зависание панели через 5-10 минут | исправлено, пока cable 1 читается |
| Смена частоты из GUI/CLI | OK (PipeWire или vendor-запрос) |
| Web-панель в браузере | OK (standard/advanced, отдельный пакет) |

## Требования

- Ядро Linux с заголовками: `/lib/modules/$(uname -r)/build` должен
  существовать (Arch: `linux-headers`/`linux-cachyos-headers`,
  Debian/Ubuntu: `linux-headers-$(uname -r)`).
- Компилятор, которым собрано ядро: для clang-ядер нужен `clang`/`llvm`,
  для gcc-ядер — `gcc`. Скрипты определяют это автоматически по `.config`.
- `python3`, `python-pyusb` (Debian: `python3-usb`).
- Для GUI: `python-pyqt6` (Debian: `python3-pyqt6`).
- Для пакетов/DKMS: `dkms`.
- Для смены частоты: PipeWire (`pw-metadata`) или свободный PCM.

## Установка одной командой

Готовые пакеты драйвера лежат в `packaging/dist/` (их можно пересобрать
скриптами ниже). Пакет драйвера собирает модуль через DKMS при установке,
поэтому подходит для любого ядра, лишь бы были его заголовки. Web-панель —
отдельный пакет `qc-webpanel`, см. `webgui/README.md`.

### Arch / CachyOS

```sh
cd packaging/arch
./build-package.sh            # создаст qc-quadcapture-1.0-1-any.pkg.tar.zst
sudo pacman -U qc-quadcapture-1.0-1-any.pkg.tar.zst
```

### Debian / Ubuntu

```sh
cd packaging/debian
./build-deb.sh                # создаст qc-quadcapture_1.0_all.deb
sudo apt install ./qc-quadcapture_1.0_all.deb
```

Пакет ставит исходники модуля в `/usr/src/qc-quadcapture-1.0`, собирает и
устанавливает модуль через DKMS, ставит `qcctl`, `qcpanel`, systemd-юнит и
пункт меню. DKMS пересоберёт модуль при обновлении ядра.

После установки, если старый модуль уже был загружен, нужен ребут (или
`sudo scripts/reload.sh` из дерева исходников), чтобы загрузился новый.

## Сборка из исходников

```sh
scripts/build.sh          # собирает module/snd-usb-audio.ko под текущее ядро
scripts/install.sh        # копирует .ko в /lib/modules/$(uname -r)/updates
scripts/reload.sh         # останавливает PipeWire, перезагружает модуль
```

Или через DKMS (рекомендуется, переживает обновления ядра):

```sh
sudo pacman -S dkms       # Debian: sudo apt install dkms
scripts/install-dkms.sh
```

Демон и панель:

```sh
sudo daemon/install-daemon.sh   # /usr/bin/qcctl + systemd qc-daemon
sudo gui/install-gui.sh         # /usr/bin/qcpanel + пункт меню
```

Либо всё сразу: `make install`.

## Демон и CLI

Демон постоянно держит открытым `hw:<card>,0,1` — это и есть лечение
зависания панели. Он опрашивает блок состояния раз в секунду, читает статус
клока с интерфейса 3 и слушает Unix-сокет `/run/qcctl.sock`.

```sh
qcctl status
qcctl set sens1 48
qcctl set comp1 1
qcctl set mix1 0x200000        # 0 dB
qcctl rate 96000               # 44100 / 48000 / 96000 / 192000
qcctl meter on
qcctl monitor
qcctl params
```

`set` ждёт эхо от устройства (flow control) и обновляет блок состояния.

## GUI

```sh
qcpanel
```

- два канала: SENS, LO-CUT, PHASE, COMP, GATE, ATTACK, RELEASE, THRESH,
  RATIO, GAIN;
- stereo link и AUTO-SENS;
- микшер IN1/IN2/COAX в дБ (0 dB = `0x200000`);
- 8 индикаторов уровня (6 аудио + 2 gain-reduction);
- статус клока и выбор частоты дискретизации прямо в окне.

Метры включаются при открытии панели и выключаются при закрытии.

## Web-панель

Отдельный пакет `qc-webpanel` поднимает браузерную панель на
`http://127.0.0.1:8765/`; она общается с тем же демоном через
`/run/qcctl.sock`.

```sh
# Arch / CachyOS
cd webgui/packaging/arch && ./build-package.sh
sudo pacman -U qc-webpanel-1.0-1-any.pkg.tar.zst

# Debian / Ubuntu
cd webgui/packaging/debian && ./build-deb.sh
sudo apt install ./qc-webpanel_1.0_all.deb
```

- `systemctl status qc-web`, логи: `journalctl -u qc-web -f`.
- Готовые пакеты также лежат в `packaging/dist/` (`qc-webpanel-*`).
- Режимы **STANDARD** (как официальная панель) и **ADVANCED** (все
  параметры; недоступные в стандартной панели помечены `!`).
- Внизу — живые уровни входов 1-2, COAX 3/4, MAIN/loopback, выходов 1-2
  и 3-4; у coax-входа/выхода нет метра в устройстве, это указано в UI.
- Подробности, API и доступ по сети: `webgui/README.md`.

## Смена частоты дискретизации

Устройство поддерживает только **44.1 / 48 / 96 / 192 кГц** (88.2/176.4
нет — для них нет altset'ов). Переключение занимает ~1.2 с, статус в это
время `unlocked`.

### Из GUI / CLI

`qcctl rate <hz>` и выпадающий список в панели делают всё сами:

1. если запущен PipeWire — выставляют `clock.allowed-rates` и
   `clock.force-rate` для графа;
2. если PCM свободен — дополнительно шлют вендорный запрос прямо в
   устройство, чтобы клок переключился сразу;
3. ждут, пока интерфейс 3 отрапортует новую частоту.

### Вручную через PipeWire

```sh
pw-metadata -n settings 0 clock.allowed-rates '[ 44100 48000 96000 192000 ]'
pw-metadata -n settings 0 clock.force-rate 96000
pw-metadata -n settings 0 clock.force-rate 0      # вернуть авто/48k
```

Смена частоты перезапускает активные стримы и действует на весь граф
PipeWire. Чтобы частоты были доступны после рестарта PipeWire, добавьте
drop-in `~/.config/pipewire/pipewire.conf.d/99-quadcapture.conf`:

```
context.properties = {
    default.clock.allowed-rates = [ 44100 48000 96000 192000 ]
}
```

### Напрямую через ALSA (без PipeWire)

```sh
systemctl --user stop pipewire.socket pipewire-pulse.socket \
    wireplumber.service pipewire.service pipewire-pulse.service
speaker-test -D hw:1,0 -r 96000 -c 4 -t sine -l 1
# или: aplay -D hw:1,0 -r 96000 -c 4 -f S32_LE file.wav
systemctl --user start wireplumber.service pipewire.service \
    pipewire.socket pipewire-pulse.socket pipewire-pulse.service
```

Драйвер переключит клок сам (vendor-запрос в `prepare()`).

## Что именно пропатчено

1. `quirks-table.h` — запись QUAD-CAPTURE: добавлены altset'ы 2-4
   (48/96/192 кГц), `in_cables`/`out_cables` изменены с `0x0001` на `0x0003`,
   чтобы cable 1 (панельный SysEx) стал вторым rawmidi-субстримом.
2. `quirks.c` — бэкпорт `roland_capture_set_rate()`: vendor-запрос
   `bRequest 3`, `wValue 8`, данные `0x40 + rate24LE`, с ожиданием
   подтверждения; подключён в `snd_usb_set_format_quirk()`.
3. `card.c` — интерфейсы 3/4 возвращают `-ENXIO` при probe, `last_iface`
   ограничен 2, чтобы карта регистрировалась после интерфейса 2 и статусные
   интерфейсы оставались свободными для usbfs.
4. `quirks.c` `create_composite_quirk()` — не захватывает интерфейсы 3/4.

Диффы против vanilla 7.3 — в `patches/`.

## Устройство

- Интерфейсы: 0 — playback (`0x05`), 1 — capture (`0x85`, implicit
  feedback), 2 — MIDI/control (`0x06`/`0x86`, bulk), 3 — статус клока
  (`0x82`, interrupt), 4 — не используется (`0x81`).
- Cable 0 — обычный MIDI, cable 1 — панельный протокол
  (`F0 41 10 00 00 56 ...`, DT1 `0x12`, RQ1 `0x11`).
- Хост обязан непрерывно читать интерфейс 2, иначе очередь панели
  переполняется и панель зависает.
- Блок состояния: RQ1 на `01 00 00 00`, 59 байт.
- Статус клока: `01 00 00 <rate24 LE> <ext> <locked>`.

## Диагностика

- `modinfo -n snd_usb_audio` — откуда загружен модуль.
- `dmesg | tail` — ошибки загрузки/vermagic.
- `systemctl status qc-daemon`, `journalctl -u qc-daemon`.
- `qcctl status` — если демон не отвечает, проверьте сокет и сервис.
- Панель зависает — демон не запущен или cable 1 не читается.
- `qcctl rate` пишет «PCM is busy» — PipeWire держит карту; используйте
  `pw-metadata` или остановите стримы.
- Модуль не грузится после обновления ядра — пересоберите
  (`scripts/build.sh` + `scripts/install.sh`) или поставьте пакет с DKMS.
- Secure Boot: подписанный модуль не загрузится без своей подписи/MOK.

## Удаление

Пакеты: `sudo pacman -R qc-quadcapture qc-webpanel` или
`sudo apt remove qc-quadcapture qc-webpanel`.

Из исходников: `scripts/uninstall.sh` (модуль/DKMS/сервис), затем удалите
`/usr/bin/qcctl`, `/usr/bin/qcpanel` и юнит при необходимости.

## Лицензия и благодарность

Спасибо louistissot за предоставленный код и описание работы драйвера и общения карты с пк(https://github.com/louistissot/quad-capture-macos-silicon-driver)
GPL-2.0-only. Исходники модуля взяты из ядра Linux.
