#!/usr/bin/env python3
# Генератор Macrodroid-макроса "Fix BT CarPlay" для Geely Atlas FX11.
# Клонирует существующий .macro (Enable_HUD.macro, использует плагин ADBPlugin
# на localhost:5555) и подменяет команды.
import json, random, sys

SRC = "/tmp/fx11/Enable_HUD.macro"
OUT = "/home/vyunolbek/GeelyAtlasFX11-CarPlayFix/macrodroid/Fix_BT_CarPlay.macro"

def sbytes(bs):
    return [(b - 256 if b > 127 else b) for b in bs]

def ubytes(lst):
    return bytes((b + 256) % 256 for b in lst)

def build_bundle(command, timeout="200"):
    raw = ubytes(SRC_BUNDLE)  # bytes
    # найти JSON-конфиг плагина
    start = raw.index(b'{"ip":')
    end = raw.index(b'}', start) + 1
    old_json = raw[start:end].decode()
    cfg = json.loads(old_json)
    cfg["command"] = command
    cfg["timeout"] = timeout
    new_json = json.dumps(cfg, separators=(",", ":"), ensure_ascii=False).encode()
    # длина TC_STRING — 2 байта BE перед строкой
    length_pos = start - 2
    out = bytearray(raw)
    out[length_pos:start] = len(new_json).to_bytes(2, "big")
    out[start:end] = new_json
    return sbytes(bytes(out))

def rnd_long():
    return random.randint(-9223372036854775808, 9223372036854775807)

src = json.load(open(SRC))
macro = src["macro"]
SRC_BUNDLE = macro["m_actionList"][0]["m_pluginInstanceData"]["mSerializedBundle"]

def plugin_action(command, timeout, comment, guid):
    a = json.loads(json.dumps(macro["m_actionList"][0]))  # глубокий клон
    a["m_pluginInstanceData"]["mSerializedBundle"] = build_bundle(command, timeout)
    a["m_pluginInstanceData"]["mBlurb"] = "localhost:5555\n" + (command[:60])
    a["m_comment"] = comment
    a["m_SIGUID"] = rnd_long()
    a["_GUID"] = guid
    return a

ACTIONS = [
    plugin_action(
        "settings delete secure key_carplay_disconnect_address",
        "2000",
        "Чинит баг: при беспроводном CarPlay ключ key_carplay_disconnect_address не чистится при отключении и блокирует BT-авто-коннект.",
        rnd_long()),
    plugin_action(
        "svc bluetooth disable && sleep 4 && svc bluetooth enable",
        "30000",
        "Перезапуск BT: при включении адаптера (state 12) сервис вызывает autoConnectDevice() и подключает телефон.",
        rnd_long()),
]

macro["m_actionList"] = ACTIONS
macro["m_name"] = "Fix BT CarPlay"
macro["m_description"] = "Geely FX11: чистка key_carplay_disconnect_address + рестарт BT — починить авто-коннект после CarPlay"
macro["m_GUID"] = rnd_long()

json.dump(src, open(OUT, "w"), ensure_ascii=False)
print("OK ->", OUT)
# проверка: распарсить bundle обратно
chk = build_bundle("TEST")
cfg = json.loads(ubytes(chk).split(b'{"ip":')[1].rsplit(b'}', 1)[0].join([b'{"ip":', b'}']).decode())
print("bundle check:", cfg["command"][:50])
