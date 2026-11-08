#!/usr/bin/env bash
# ================================================================
#  Мониторинг CarPlay/BT-логов Geely FX11 во время поездки.
#  Пиши лог в файл, чтобы после очередного отвала увидеть,
#  какое именно условие не сработало (wifi ap disabled / mac mismatch /
#  connectBT failed / таймаут 15с и т.д.).
#
#  Использование: ./scripts/cp-monitor.sh [IP_машины] [файл_лога]
#  Останов: Ctrl+C. Файл потом кидай мне на разбор.
# ================================================================
set -u

IP="${1:-}"
LOG="${2:-carplay-$(date +%Y%m%d-%H%M%S).log}"

if ! command -v adb >/dev/null 2>&1; then
  echo "ADB не найден: sudo apt install adb" >&2; exit 1
fi

[ -z "$IP" ] && IP="192.168.100.100"   # последний известный IP ГУ

adb connect "$IP:5555"
sleep 1
if ! adb get-state 2>&1 | grep -q '^device'; then
  echo "Нет adb-соединения с $IP — проверь, что ноут в одной сети с машиной." >&2; exit 1
fi

echo "Пишу лог в $LOG (Ctrl+C чтобы остановить)"
adb logcat -c   # чистим старый буфер
adb logcat -v time \
  "ReconnectManager:V" "BluetoothManager:V" "DeviceConnectService:V" \
  "DeviceConnectManager:V" "BtDeviceMonitor:V" "WifiDeviceMonitor:V" \
  "BTS.ConnectionPolicy:V" "CarPlayService:V" "BluetoothManagerService:V" \
  "WifiApManager:V" "XLog:V" \
  | tee "$LOG"
