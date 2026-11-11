# QUAD-CAPTURE web panel

Веб-панель для Roland QUAD-CAPTURE (`0582:012f`). Работает поверх демона
`qcctl` из пакета `qc-quadcapture`: сервер читает состояние через
`/run/qcctl.sock`, а браузер общается с сервером по HTTP.

```
браузер  ──HTTP──▶  qc-web (127.0.0.1:8765)  ──unix──▶  qcctl daemon  ──▶  устройство
```

## Установка

Пакет ставится отдельно от драйвера, но требует уже установленный
`qc-quadcapture` (демон и модуль).

### Arch / CachyOS

```sh
cd webgui/packaging/arch
./build-package.sh
sudo pacman -U qc-webpanel-1.0-1-any.pkg.tar.zst
```

### Debian / Ubuntu

```sh
cd webgui/packaging/debian
./build-deb.sh
sudo apt install ./qc-webpanel_1.0_all.deb
```

Пакет ставит:

| Путь | Что это |
|---|---|
| `/usr/bin/qc-web` | HTTP-сервер (stdlib Python) |
| `/usr/share/qc-web/` | `index.html`, `style.css`, `app.js` |
| `/usr/lib/systemd/system/qc-web.service` | юнит, слушает `127.0.0.1:8765` |
| `/usr/share/doc/qc-webpanel/README.md` | этот файл |

После установки сервис включается и запускается автоматически. Открыть:
<http://127.0.0.1:8765/>.

```sh
systemctl status qc-web
journalctl -u qc-web -f
```

## Режимы

* **STANDARD** — повторяет официальную панель Roland: PREAMP (LO-CUT, PHASE,
  CLIP, SENS, AUTO SENS), COMPRESSOR (BYPASS, GR, кривая, GATE, THRESHOLD,
  RATIO, ATTACK, RELEASE, GAIN, LINK), MIXER (OUTPUT 1-2, INPUT 1, INPUT 2,
  COAX 3/4), внизу SAMPLE RATE и CLOCK.
* **ADVANCED** — все параметры протокола, включая те, которых нет в
  стандартной панели: `OUTPUT SELECT`, `DIGITAL IN`, `AUTO-SENS MODE`,
  `AUTO-SENS MARGIN`, `LEVEL METER`, монитор-микшер, сырой блок состояния
  (59 байт), произвольные RQ1/DT1 и инициализация. Такие параметры помечены
  красным `!`.

Режим запоминается в `localStorage`; можно открыть сразу advanced:
`http://127.0.0.1:8765/?mode=adv`.

## Каналы и уровни

| Группа | Что показывается |
|---|---|
| INPUT 1-2 | живые метры IN 1 / IN 2 (значения 1, 2) |
| INPUT 3-4 (COAX IN) | уровень COAX в монитор-миксе; прямого метра coax-входа у устройства нет |
| MAIN (LOOPBACK) | метры OUTPUT L/R (5, 6); отдельных метров loopback нет |
| OUTPUT 1-2 | метры OUTPUT L/R после микшера (5, 6) |
| OUTPUT 3-4 (COAX OUT) | метра нет: это каналы playback 3/4 хоста (S/PDIF) |

Метры 14-битные: `dB = 20·log10(v / 16383)`. Значения 7/8 — gain reduction
компрессоров, `16383` = без редукции. Устройство не отдаёт метры coax-входа
и coax-выхода, поэтому для них показаны только уровни микшера / пояснение.

## Доступ по сети

По умолчанию сервер слушает только `127.0.0.1`. Чтобы открыть панель с
другого устройства, создайте drop-in:

```sh
sudo systemctl edit qc-web.service
```

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/qc-web --host 0.0.0.0 --port 8765
```

```sh
sudo systemctl daemon-reload
sudo systemctl restart qc-web
```

**Внимание:** у панели нет аутентификации. Не открывайте её в недоверенную
сеть; при необходимости поставьте reverse proxy с паролем.

## HTTP API

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/status` | — | `{clock, meters, state}` |
| GET | `/api/read?addr=00%2002%2000%2004&size=1` | — | `{ok, data}` |
| GET | `/api/params` | — | список имён |
| POST | `/api/param` | `{"name":"sens1","value":54}` | `{ok}` |
| POST | `/api/raw` | `{"addr":"00 05 00 04","data":"36"}` | `{ok}` |
| POST | `/api/rate` | `{"value":96000}` | `{ok, rate, sources}` |
| POST | `/api/meter` | `{"value":1}` | `{ok}` |

Смена частоты идёт через PipeWire (если доступен) и/или vendor-запрос к
устройству; vendor-запрос возможен только при остановленном PCM.

## Ручной запуск и разработка

```sh
# из исходников, без установки
python3 webgui/server.py --host 127.0.0.1 --port 8765
```

Сервер ищет статику в `/usr/share/qc-web`, затем в `static/` рядом с
`server.py`. Демон должен быть запущен (`systemctl start qc-daemon`).

## Сборка пакетов

```sh
webgui/packaging/arch/build-package.sh     # -> webgui/packaging/arch/*.pkg.tar.zst
webgui/packaging/debian/build-deb.sh       # -> webgui/packaging/debian/*.deb
```

Готовые файлы также копируются в `webgui/packaging/dist/`.
