#!/usr/bin/env python3
# Генератор Macrodroid-макроса "Fix BT CarPlay" для Geely Atlas FX11.
# Клонирует существующий .macro (Enable_HUD.macro, использует плагин ADBPlugin
# на localhost:5555) и подменяет команды.
import json, random, sys

SRC = "/tmp/fx11/Enable_HUD.macro"
OUTDIR = "/home/vyunolbek/GeelyAtlasFX11-CarPlayFix/macrodroid"

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
]

ACTIONS_RECOVER = [
    plugin_action(
        "su 0 kill $(pidof com.autolink.carplay)",
        "5000",
        "Перезапуск CarPlay-сервиса (persistent, перезапустится сам): при старте reconnectOnStart() пересобирает сессию по последнему устройству. Замена отвязки/привязки телефона.",
        rnd_long()),
    plugin_action(
        "svc bluetooth disable && sleep 4 && svc bluetooth enable",
        "30000",
        "Перезапуск BT: при включении адаптера (state 12) сервис вызывает autoConnectDevice() и подключает телефон.",
        rnd_long()),
]

ACTIONS_CLEAR = [
    plugin_action(
        "am force-stop ru.kinopoisk && am force-stop ru.vk.store && am force-stop ru.yandex.music && am force-stop io.github.muntashirakon.AppManager && am force-stop com.alphainventor.filemanager && am force-stop app.revanced.android.youtube && am force-stop org.localsend.localsend_app && am force-stop com.android.launcher3",
        "20000",
        "Останавливает кэш-приложения и освобождает ~4 ГБ RAM перед поездкой. Приложения вернутся при запуске. Launcher3 (штатный Geely-лаунчер с CarLink/поиском) перезапустится, только когда он понадобится системе.",
        rnd_long()),
]

def write_macro(name, descr, actions, fname):
    m = json.loads(json.dumps(macro))
    m["m_actionList"] = actions
    m["m_name"] = name
    m["m_description"] = descr
    m["m_GUID"] = rnd_long()
    out = {"macro": m, "macroExportVersion": src["macroExportVersion"]}
    path = f"{OUTDIR}/{fname}"
    json.dump(out, open(path, "w"), ensure_ascii=False)
    print("OK ->", path)

write_macro(
    "Fix BT CarPlay",
    "Geely FX11: чистка key_carplay_disconnect_address — починить авто-коннект BT после CarPlay",
    ACTIONS[:1],
    "Fix_BT_CarPlay.macro")

write_macro(
    "Recover CarPlay",
    "Geely FX11: восстановление CarPlay после отвала (замена отвязки/привязки телефона)",
    ACTIONS_RECOVER,
    "Recover_CarPlay.macro")

write_macro(
    "Clear RAM",
    "Geely FX11: остановка кэш-приложений — освободить память перед поездкой",
    ACTIONS_CLEAR,
    "Clear_RAM.macro")
