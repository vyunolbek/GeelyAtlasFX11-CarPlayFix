#!/usr/bin/env bash
# ================================================================
#  Перезапуск CarPlay/Bluetooth на Geely FX11 (G636) БЕЗ перепривязки.
#  Замена танца "отвязать/привязать телефон".
#
#  Что делает:
#   1. подключается к ГУ по adb over Wi-Fi (машина должна быть в одной сети)
#   2. чистит залипший ключ key_carplay_disconnect_address
#      (баг: при беспроводном CarPlay не чистится при отключении и
#       блокирует BT-авто-коннект — см. DETAILS_TECH)
#   3. перезапускает CarPlay-сервис (reconnectOnStart поднимет сессию
#      по последнему устройству) и DCM
#   4. перезапускает BT-стек
#
#  Использование: ./scripts/fix-carplay.sh [IP_машины]
# ================================================================
set -u

IP="${1:-}"
PORT=5555

if ! command -v adb >/dev/null 2>&1; then
  echo "ADB не найден: sudo apt install adb" >&2; exit 1
fi

# --- найти IP машины, если не задан ---
find_ip() {
  # попробовать последний известный
  for ip in 192.168.100.100; do
    timeout 1 bash -c "echo > /dev/tcp/$ip/$PORT" 2>/dev/null && { echo "$ip"; return; }
  done
  # пинг-свип своей подсети и проба 5555 на живых
  SUBNET="$(ip -4 addr show scope global | grep -oE 'inet [0-9.]+' | awk '{print $2}' | cut -d. -f1-3 | head -1)"
  [ -z "$SUBNET" ] && return
  for i in $(seq 1 254); do (ping -c1 -W1 "$SUBNET.$i" >/dev/null 2>&1 &); done
  sleep 3
  for ip in $(ip neigh | grep REACHABLE | awk '{print $1}'); do
    timeout 1 bash -c "echo > /dev/tcp/$ip/$PORT" 2>/dev/null && { echo "$ip"; return; }
  done
}

if [ -z "$IP" ]; then
  IP="$(find_ip)"
  if [ -z "$IP" ]; then
    echo "Не нашёл ГУ в сети. Подключи ноут к той же Wi-Fi сети, что и машина," >&2
    echo "или укажи IP явно: ./scripts/fix-carplay.sh 192.168.x.x" >&2; exit 1
  fi
fi

echo "=== Подключаюсь к ГУ $IP:$PORT ==="
adb connect "$IP:$PORT"
sleep 1
if ! adb get-state 2>&1 | grep -q '^device'; then
  echo "Нет adb-соединения с $IP" >&2; exit 1
fi
adb root >/dev/null 2>&1; sleep 2; adb connect "$IP:$PORT" >/dev/null 2>&1

echo "=== 1. Чищу залипший key_carplay_disconnect_address ==="
echo "  было: $(adb shell settings get secure key_carplay_disconnect_address)"
adb shell settings delete secure key_carplay_disconnect_address
echo "  стало: $(adb shell settings get secure key_carplay_disconnect_address) (null = ок)"

echo "=== 2. Перезапускаю CarPlay-сервис (reconnect по последнему устройству) ==="
adb shell am force-stop com.autolink.carplay
sleep 1
adb shell "am start-service -n com.autolink.carplay/.CarPlayService" >/dev/null 2>&1

echo "=== 3. Перезапускаю BT-стек ==="
adb shell svc bluetooth disable; sleep 4
adb shell svc bluetooth enable; sleep 8

echo "=== Состояние ==="
adb shell dumpsys bluetooth_manager | grep -E "state:|Bonded devices" -A2 | head -8
echo
echo "Готово. Если iPhone не подключился сам — выключи/включи Bluetooth на телефоне."
