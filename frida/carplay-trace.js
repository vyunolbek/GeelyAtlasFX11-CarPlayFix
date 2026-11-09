// Trace-only diagnostics for Geely/Autolink wireless CarPlay.
// Load into com.autolink.carplay. This script only observes method calls and
// state; it never writes settings or initiates a connection/disconnection.
'use strict';

const PREFIX = '[CPTRACE]';
const LOG_PATH = '/data/data/com.autolink.carplay/files/carplay-trace.log';
let DeviceManager = null;
let logFile = null;
let fileFailed = false;

function timestamp() {
    return new Date().toISOString();
}

// Frida's QuickJS runtime provides a File API; writing directly to a file
// avoids frida-inject's fully buffered stdout when stdout is not a TTY.
function openLogFile() {
    try {
        logFile = new File(LOG_PATH, 'ab');
    } catch (error) {
        logFile = null;
        // Append mode may be unsupported by the runtime; retry with truncate.
        try {
            logFile = new File(LOG_PATH, 'wb');
        } catch (error2) {
            logFile = null;
            fileFailed = true;
            console.log(`${PREFIX} FILE_ERROR ${error2}`);
        }
    }
}

function log(message) {
    const line = `${PREFIX} ${timestamp()} ${message}`;
    try {
        if (logFile === null && !fileFailed) {
            openLogFile();
        }
        if (logFile !== null) {
            logFile.write(line + '\n');
            logFile.flush();
        }
    } catch (error) {
        // Fall back to stdout (visible with frida CLI); never raise from logging.
    }
    console.log(line);
}

function describeError(error) {
    return `${error}`;
}

function guarded(label, callback) {
    try {
        callback();
    } catch (error) {
        log(`LOG_ERROR ${label}: ${describeError(error)}`);
    }
}

function value(callback, fallback = '<error>') {
    try {
        const result = callback();
        return result === null || result === undefined ? '<null>' : `${result}`;
    } catch (error) {
        return `<error: ${describeError(error)}>`;
    }
}

function carPlayState() {
    return value(() => {
        if (DeviceManager === null) {
            DeviceManager = Java.use('com.autolink.carplay.adapter.device.DeviceManager');
        }
        const device = DeviceManager.getInstance().getCarPlayDevice();
        if (device === null) {
            return 'carPlayDevice=<null>';
        }
        return 'carPlayDevice={' +
            `id=${value(() => device.getDeviceID())}, ` +
            `btMac=${value(() => device.getBtMac())}, ` +
            `wifiMac=${value(() => device.getWifiMac())}, ` +
            `capaType=${value(() => device.getCapaType())}, ` +
            `mirrorStatus=${value(() => device.getMirrorStatus())}, ` +
            `disconnectRes=${value(() => device.getDisConnectRes())}, ` +
            `oobAutoConnect=${value(() => device.isOobAutoConnect())}` +
            '}';
    });
}

function bluetoothManagerState(instance) {
    return value(() => {
        const reconnectDevice = instance.mBluetoothDevice.value;
        const reconnectMac = reconnectDevice === null
            ? '<null>'
            : value(() => reconnectDevice.getAddress());
        return `btManager={mConnecting=${instance.mConnecting.value}, ` +
            `mCheckReason=${instance.mCheckReason.value}, ` +
            `reconnectMac=${reconnectMac}}`;
    });
}

function bluetoothManagerDetails(instance) {
    return value(() => {
        const adapter = instance.mAdapter.value;
        return `${bluetoothManagerState(instance)}, ` +
            `btEnabled=${value(() => adapter.isEnabled())}, ` +
            `wifiApEnabled=${value(() => instance.isWifiApEnabled())}`;
    });
}

function deviceAddress(device) {
    return device === null ? '<null>' : value(() => device.getAddress());
}

function dcmDeviceId(device) {
    return device === null ? '<null>' : value(() => device.getID());
}

function intentDescription(intent) {
    if (intent === null) {
        return 'intent=<null>';
    }
    return `action=${value(() => intent.getAction())}, ` +
        `macInfo=${value(() => intent.getStringExtra('macInfo'))}`;
}

function hook(className, methodName, argumentTypes, callbacks = {}) {
    try {
        const clazz = Java.use(className);
        const method = clazz[methodName];
        const overload = argumentTypes.length === 0
            ? method.overload()
            : method.overload(...argumentTypes);

        overload.implementation = function () {
            const args = arguments;
            if (callbacks.enter) {
                guarded(`${className}.${methodName}.enter`, () => callbacks.enter(this, args));
            }

            let result;
            try {
                // Always execute the original implementation with unchanged args.
                result = overload.apply(this, args);
            } catch (error) {
                log(`THROW ${className}.${methodName}: ${describeError(error)}`);
                throw error;
            }

            if (callbacks.exit) {
                guarded(`${className}.${methodName}.exit`,
                    () => callbacks.exit(this, args, result));
            }
            return result;
        };
        log(`HOOK_OK ${className}.${methodName}(${argumentTypes.join(', ')})`);
    } catch (error) {
        log(`HOOK_ERROR ${className}.${methodName}: ${describeError(error)}`);
    }
}

Java.perform(function () {
    const bluetoothManager = 'com.autolink.carplay.reconnect.BluetoothManager';
    const reconnectManager = 'com.autolink.carplay.reconnect.ReconnectManager';
    const deviceConnection = 'com.autolink.carplay.DeviceConnectionImpl';
    const dcm = 'com.autolink.dcm.DeviceConnectManager';

    hook(bluetoothManager, 'startReconnect', ['java.lang.String'], {
        enter(instance, args) {
            log(`ENTER startReconnect btMac=${args[0]}, ${bluetoothManagerDetails(instance)}, ${carPlayState()}`);
        },
        exit(instance) {
            log(`EXIT startReconnect ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'startReconnectNeighborhood', ['java.lang.String'], {
        enter(instance, args) {
            log(`ENTER startReconnectNeighborhood btMac=${args[0]}, ${bluetoothManagerState(instance)}`);
        },
        exit(instance) {
            log(`EXIT startReconnectNeighborhood ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'connect', ['android.bluetooth.BluetoothDevice'], {
        enter(instance, args) {
            log(`ENTER connect device=${deviceAddress(args[0])}, ${bluetoothManagerDetails(instance)}, ${carPlayState()}`);
        },
        exit(instance) {
            log(`EXIT connect ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'connectBluetoothDeviceByMac', ['java.lang.String'], {
        enter(instance, args) {
            log(`ENTER connectBluetoothDeviceByMac btMac=${args[0]}, ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'stopReconnect', [], {
        enter(instance) {
            log(`ENTER stopReconnect ${bluetoothManagerState(instance)}`);
        },
        exit(instance) {
            log(`EXIT stopReconnect ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'onWifiJoin', ['android.content.Intent'], {
        enter(instance, args) {
            log(`ENTER BluetoothManager.onWifiJoin ${intentDescription(args[0])}, ${bluetoothManagerState(instance)}`);
        }
    });

    hook(bluetoothManager, 'onBroadcastReceive', ['android.content.Context', 'android.content.Intent'], {
        enter(instance, args) {
            log(`ENTER BluetoothManager.onBroadcastReceive ${intentDescription(args[1])}, ${bluetoothManagerState(instance)}`);
        }
    });

    hook(`${reconnectManager}$2`, 'onReceive', ['android.content.Context', 'android.content.Intent'], {
        enter(instance, args) {
            log(`ENTER ReconnectManager.receiver ${intentDescription(args[1])}, ${carPlayState()}`);
        },
        exit(instance, args) {
            log(`EXIT ReconnectManager.receiver action=${value(() => args[1].getAction())}, ${carPlayState()}`);
        }
    });

    hook(reconnectManager, 'reconnectOnStart', [], {
        enter() {
            log(`ENTER reconnectOnStart ${carPlayState()}`);
        }
    });

    hook(reconnectManager, 'setReconnect', ['int', 'int'], {
        enter(instance, args) {
            log(`ENTER setReconnect type=${args[0]}, status=${args[1]}, ${carPlayState()}`);
        },
        exit() {
            log(`EXIT setReconnect ${carPlayState()}`);
        }
    });

    hook(deviceConnection, 'onConnectionStateChange', ['com.autolink.dcm.DcmDevice', 'int'], {
        enter(instance, args) {
            log(`ENTER onConnectionStateChange device=${dcmDeviceId(args[0])}, state=${args[1]}, ${carPlayState()}`);
        },
        exit() {
            log(`EXIT onConnectionStateChange ${carPlayState()}`);
        }
    });

    hook(deviceConnection, 'onDcmDeviceDisconnect', ['com.autolink.dcm.DcmDevice'], {
        enter(instance, args) {
            log(`ENTER onDcmDeviceDisconnect device=${dcmDeviceId(args[0])}, ${carPlayState()}`);
        },
        exit() {
            log(`EXIT onDcmDeviceDisconnect ${carPlayState()}`);
        }
    });

    hook(dcm, 'connectBT', ['java.lang.String'], {
        enter(instance, args) {
            log(`ENTER DCM.connectBT btMac=${args[0]}, ${carPlayState()}`);
        },
        exit(instance, args, result) {
            log(`EXIT DCM.connectBT btMac=${args[0]}, result=${result}`);
        }
    });

    hook(dcm, 'connectDcmDeviceByID', ['java.lang.String'], {
        enter(instance, args) {
            log(`ENTER DCM.connectDcmDeviceByID id=${args[0]}, ${carPlayState()}`);
        },
        exit(instance, args) {
            log(`EXIT DCM.connectDcmDeviceByID id=${args[0]}`);
        }
    });

    hook(dcm, 'doStartWifiAp', ['int'], {
        enter(instance, args) {
            log(`ENTER DCM.doStartWifiAp band=${args[0]}, ${carPlayState()}`);
        }
    });

    hook('com.autolink.carplay.adapter.device.CarPlayDevice', 'setDisconnectRes', ['int'], {
        enter(instance, args) {
            log(`ENTER CarPlayDevice.setDisconnectRes old=${value(() => instance.getDisConnectRes())}, new=${args[0]}`);
        }
    });

    log(`READY trace-only; no behavior overrides or settings writes; ${carPlayState()}`);
});
