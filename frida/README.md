# Frida trace-only diagnostics (Geely/Autolink CarPlay)

`carplay-trace.js` observes the wireless-CarPlay reconnect chain inside
`com.autolink.carplay` without changing any behavior: every hook calls the
original method with unchanged arguments and only logs events, state fields
and return values. No settings writes, no connection requests, no restarts.

Hooks cover: `ReconnectManager` (wifi leave/join, bond changes, `setReconnect`,
`reconnectOnStart`), `BluetoothManager` (`startReconnect`, `connect`,
`stopReconnect`, `mConnecting`/`mCheckReason`), `DeviceConnectionImpl`
(`onConnectionStateChange`, `onDcmDeviceDisconnect`), `DeviceConnectManager`
(`connectBT`, `connectDcmDeviceByID`, `doStartWifiAp`) and
`CarPlayDevice.setDisconnectRes`.

## Build (host)

```bash
npm install frida-compile frida-java-bridge
cp carplay-trace.js trace-body.js
npx frida-compile entry.js -o carplay-trace-compiled.js
# strip the trailing "✄"-separated source map from the bundle
```

`frida-java-bridge` must be bundled explicitly: since Frida 17, `Java` is not
predefined in the plain script runtime used by `frida-inject` (it still is
when attaching with the `frida` CLI against `frida-server`).

## Deploy (device)

```bash
adb push frida-inject /data/local/tmp/        # frida-inject-*-android-arm64
adb push carplay-trace-compiled.js /data/local/tmp/
adb shell chmod 755 /data/local/tmp/frida-inject
adb shell "su 0 mkdir -p /data/data/com.autolink.carplay/files && \
           su 0 chown system:system /data/data/com.autolink.carplay/files"
```

## Run on the head unit

```bash
CP_PID=$(adb shell pidof com.autolink.carplay)
adb shell "nohup su 0 sh -c '/data/local/tmp/frida-inject -p $CP_PID \
    -s /data/local/tmp/carplay-trace-compiled.js \
    > /data/local/tmp/carplay-trace-local.out 2>&1' > /dev/null 2>&1 &"
```

Notes learned on this unit:

- the log is written **directly from the JS via the Frida `File` API** to
  `/data/data/com.autolink.carplay/files/carplay-trace.log` (a dir writable by
  the target's system uid). `frida-inject` fully buffers stdout when it is not
  a TTY, so stdout is not usable for live capture.
- `new File(path, 'ab')` failed on this firmware; the script retries with
  `'wb'` (truncate) and logs `FILE_ERROR` on stdout if both fail.
- the recorder is a plain root process on the HU: it keeps recording after the
  laptop/ADB connection is lost, and everything is gone after a reboot.

## Retrieve

```bash
adb shell "su 0 cat /data/data/com.autolink.carplay/files/carplay-trace.log"
```

## Reproduce a wireless dropout safely

1. While CarPlay is fully working, turn iPhone **Wi-Fi off for 5–10 s**
   (Настройки → Wi-Fi, not the Control Center toggle), then back on.
2. Wait 60–90 s without touching anything else.
3. The trace then shows exactly where the recovery chain stopped:
   `WIFI_AP_STA_LEAVE` → `startReconnect` → `DCM.connectBT` (result true/false)
   → `WIFI_AP_STA_JOIN` → `connectDcmDeviceByID` → mirror status changes.

Do not use "Забыть автомобиль"/unpair for this test — that exercises the
full-reset path, not the reconnect chain.
