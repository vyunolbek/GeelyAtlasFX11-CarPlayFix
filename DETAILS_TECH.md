# Технические детали: CarPlay / Bluetooth на Geely Atlas FX11

📖 README: **[README.md](README.md)**

Машина/прошивка, на которой всё разбиралось:
- **Geely Atlas 2024 (FX11 / Boyue L)**, ГУ: `ro.product.model = G636`, `ro.product.device = ecarx`
- Android 11, **`userdebug`**-сборка (сборка от января 2026)
- Штатный **беспроводной CarPlay** (сервисы `com.autolink.*`, вендор Autolink/ECARX)
- Bluetooth: AOSP-стек (`com.android.bluetooth`) + вендорский сервис `com.autolink.bluetoothservice`

Ключевой факт прошивки: **`userdebug`** → `adb root` работает, adbd слушает TCP 5555 по сети без активаций. В отличие от Cityray (G426, `user`), замков на установку тут нет вовсе (`pm install-create` работает штатно).

---

## 1. Что декомпилировали

Системные APK (доступны через `adb pull`, пути из `pm path`):

| APK | Пакет | Что внутри |
|---|---|---|
| `/system/app/CarPlayService/CarPlayService.apk` | `com.autolink.carplay` | `ReconnectManager`, `BluetoothManager`, `DeviceConnectionImpl`, `IapStackCallback` — вся логика CarPlay и переподключения |
| `/system/app/DeviceConnectService/DeviceConnectService.apk` | `com.autolink.dcm` | `DeviceConnectManager`, `BtDeviceMonitor`, `WifiDeviceMonitor` — транспортный слой (BT/iAP2, Wi-Fi AP, USB) |
| `/system/app/BluetoothService/BluetoothService.apk` | `com.autolink.bluetoothservice` | `ConnectionPolicy` — BT-авто-коннект при старте |

Декомпиляция: jadx. Ничего проприетарного здесь не публикуется — только разбор поведения.

---

## 2. Баг 1: BT-авто-коннект мёртв после беспроводного CarPlay

### Симптом
После использования CarPlay машина не подключается к телефону по BT автоматически. Отвязка/привязка «лечит» — до следующего раза.

### Механика (по коду)

В `BluetoothService` (`ConnectionPolicy.autoConnectDevice()`) авто-коннект при старте BT **полностью пропускается**, если непустой settings-ключ:

```java
public void autoConnectDevice() {
    String macAddress = getCarplayDisconnectAddress();   // Settings.Secure "key_carplay_disconnect_address"
    if (!TextUtils.isEmpty(macAddress)) {
        Log.w(TAG, "key_carplay_disconnect_address : " + macAddress);
        return;                                          // ← замок: даже список устройств не читается
    }
    // далее: mainDevices из Settings.System "key_device_address" (до 2 последних),
    // по 3 попытки с окном 10 сек, затем "other devices" (bonded, не main)
    // подключение: mAdapter.connectAllEnabledProfiles(device)
}
```

### Кто пишет и кто чистит ключ (в `CarPlayService`)

| Место | Когда | Что делает |
|---|---|---|
| `IapStackCallback.onNotifyOOBBTPairingLinkKeyInformation` | OOB-пейринг при беспроводном CarPlay | пишет `KEY_CARPLAY_DISCONNECT_ADDRESS = btMac`, ставит `oobAutoConnect=true` |
| `DeviceConnectionImpl.onConnectionStateChange` (DCM connect, `state==1`) | подключение CarPlay-устройства, `capaType == 0` | пишет ключ = btMac, ставит `oobAutoConnect=false` |
| `DeviceConnectionImpl.onDcmDeviceDisconnect` | отключение CarPlay-устройства | **чистит ключ ТОЛЬКО если `capaType == 0`** |

**Баг:** при беспроводном CarPlay (`capaType != 0`) ключ пишется, но при отключении **не чистится никогда** → BT-авто-коннект заблокирован навсегда.

### Лечение (проверено)

```bash
adb shell settings delete secure key_carplay_disconnect_address
adb shell svc bluetooth disable; sleep 3; adb shell svc bluetooth enable
```

После рестарта BT `handleAdapterStateChange(state==12)` вызывает `autoConnectDevice()` — уже без замка. Проверено на реальной машине: A2DP + HFP (HeadsetClient) + AVRCP поднялись автоматически.

Bond и политики профилей трогать не нужно — они остаются корректными (`A2DP_SINK=100, HEADSET_CLIENT=100, PBAP_CLIENT=100, MAP_CLIENT=100` в metadata bonded-устройства).

---

## 3. Баг 2: почему CarPlay не переподключается сам

### Архитектура переподключения (по коду `ReconnectManager` / `BluetoothManager`)

Беспроводной CarPlay держится на двух носителях:
- **BT (iAP2)** — стартовый handshake и управление (`CarPlayBtTransport`, UUID `00000000-DECA-FADE-DECA-DEAFDECACAFE`);
- **Wi-Fi AP машины** — данные. Телефон заходит в AP машины (события `WIFI_AP_STA_JOIN` / `WIFI_AP_STA_LEAVE`).

Цепочка восстановления после обрыва Wi-Fi:

```
WIFI_AP_STA_LEAVE (телефон отвалился от AP):
    disConnectRes == -1 → disConnectRes = 2 → BluetoothManager.startReconnect(btMac)

startReconnect — и сразу четыре тихих выхода:
    ❌ BT выключен
    ❌ mConnecting == true (залипло с прошлой попытки)
    ❌ isWifiApEnabled() == false  (AP машины не поднята)
    ❌ какое-то BT-устройство уже подключено
    ⏱ иначе: окно 15 сек → connect() → DCM.connectBT(btMac)   (iAP2 по BT)

WIFI_AP_STA_JOIN (телефон снова в AP):
    матчинг по carPlayDevice.getWifiMac() (сохранённый MAC!)
    → disConnectRes in (2, -1) или == 6 → DeviceConnectManager.connectDcmDeviceByID(btMac)
```

### Пять точек отказа

1. **Одноразовые таймеры.** Окно 15 сек (`sendEmptyMessageDelayed(1, 15000L)`), при неудаче `mCheckReason = 0` — и **цикла повторов нет**. Если в окне BT не поднялся (глушилка ещё работает) — reconnect сдан, никто его не перезапустит.
2. **`mConnecting` залипает.** Все последующие `startReconnect` выходят на `mConnecting == true` до какого-нибудь события с `stopReconnect()`.
3. **`isWifiApEnabled() == false`** — AP машины умерла при глушении и сама не поднялась → тихий выход.
4. **MAC-матчинг по рандомизированному адресу.** Обработчик JOIN сравнивает клиента с сохранённым `lastWifiMac` — у iPhone это **private randomized MAC**, который iOS ротирует. Не совпало → `connectDcmDeviceByID` не вызывается → сессия не возобновляется. Перепривязка пересобирает свежий MAC — поэтому «отвязать/привязать» и работает.
5. **Самодемонтаж сессии.** В обработчике `WIFI_AP_STA_LEAVE` при `mirrorStatus == 2` сервис **сам** отправляет `CARPLAY_REQ_DISCONNECT_DEVICE` — один неудачный цикл, и сессия демонтирована.

### Почему переподписанный патч невозможен

- `/system/app/*.apk` подписаны приватным ключом **Autolink** (`O=Autolink Co., Ltd., CN=platform`, self-signed, notBefore 2021).
- Все системные сервисы в shared UID **`android.uid.system`** → пакет с иной подписью будет отброшен при boot-скане PMS.
- `/system` защищён dm-verity (AVB).
- Конфигов/properties для reconnect нет: в dex только включатели `persist.autolink.carplay.enable`, `persist.autolink.wireless.carplay.enable`, `persist.autolink.androidauto.enable`; все таймауты захардкожены.

### Что помогает (без прошивки)

1. **iPhone: Частный адрес Wi-Fi → Фиксированный** для сети машины — убирает ротацию MAC (точка отказа №4).
2. **`scripts/fix-carplay.sh`** — вместо «отвязать/привязать»: чистка ключа + `force-stop com.autolink.carplay` (при рестарте `reconnectOnStart()` пересобирает сессию по последнему устройству) + рестарт BT. Bond сохраняется.
3. **`scripts/cp-monitor.sh`** — лог во время поездки; по нему видно, какая из точек отказа сработала.
4. Радикально: патченная прошивка **GMC** для FX11 (там логика исправлена вендорским путём).

---

## 4. Инженерное меню FX11 (для справки)

- Код: **`#*32279`** (звёздочка и решётка наоборот, не как на Cityray).
- Пункты: Настройка (метка времени, сброс к заводским), Обновление, Журнал (экспорт журналов на USB), Версия, TCAM, **Конфигурация CC** (read-only таблица number/name/value; CC = Customer Customization), PSD (bt ver, hw_id и т.д.), Смена языка.
- **Пункта ADB switch, как на Cityray, нет** — он и не нужен: ADB по сети уже открыт на этой сборке.
- Выгрузка логов (аналог Export Log с Cityray): Журнал → экспорт на USB; в bugreport-*.txt ищется `QRCodeDialog` (поля salt/password/sn) — алгоритм расчёта кода описан в репозитории [GeelyCityray-AppInstaller](https://github.com/vyunolbek/GeelyCityray-AppInstaller) (для FX11 поле принимает 10 символов, тот же HKDF, берутся первые 10 байт).

---

## 5. Методика (как это всё находилось)

1. `adb connect <ip>:5555` + `adb root` (userdebug) → root shell на ГУ.
2. `dumpsys bluetooth_manager` — состояние, bonded-устройства, политики профилей, enable-лог.
3. `/data/data/com.autolink.carplay/shared_prefs/` — состояние CarPlay (`LastDevice.xml`, `LastAppState.xml`).
4. `settings get/put/delete secure/system` — ключи state machine (`key_carplay_disconnect_address`, `key_device_address`).
5. Декомпиляция системных APK (jadx) → разбор логики авто-коннекта и reconnect.
6. `logcat` по тегам `BTS.ConnectionPolicy`, `ReconnectManager`, `DeviceConnectService` — подтверждение вживую (до фикса: тишина на месте замка; после: `start auto connectDevice`).
