const childProcess = require('child_process');
const fs = require('fs');

const asyncly = require('asyncly');
const LaunchDarkly = require('launchdarkly-node-client-sdk');
const {machineIdSync} = require('node-machine-id');
const os = require('os');
const osName = require('os-name');

const LD_CLIENTSIDE_ID = process.env['LD_CLIENTSIDE_ID'];
const SUFFIX = os.type() === "Windows_NT" ? 'bat' : 'sh';
const SLASH = os.type() === "Windows_NT" ? '\\' : '/';

const FLAG_PREFIX = 'thing-';
const FLAG_INTERVAL_SUFFIX = '-interval';

let currentuser = null;
function getUser() {
    return currentuser = {
        key: machineIdSync(),
        name: os.hostname(),
        custom: {
            uptime: os.uptime(),
            type: os.type(),
            arch: os.arch(),
            freemem: os.freemem(),
            totalmem: os.totalmem(),
            percentmem: 0 - (os.freemem() / os.totalmem()),
            platform: os.platform(),
            cpu_speed: os.cpus()[0].speed,
            platform: osName()
        }
    };
}


const ldClient = LaunchDarkly.initialize(LD_CLIENTSIDE_ID, getUser());
console.log(currentuser);

let things = {};
ldClient.on('ready', () => {
    ldClient.on('change', handleChange);
    handleChange(ldClient.allFlags());
    function handleChange(allChanges) {
        ldClient.identify(getUser());
        const allFlags = ldClient.allFlags();
        for (let flag in allChanges) {
            let startsWith = flag.startsWith(FLAG_PREFIX);
            let endsWith = flag.endsWith(FLAG_INTERVAL_SUFFIX);
            if (!startsWith) continue;
            if (endsWith) {
                const newFlag = flag.slice(0, 0-FLAG_INTERVAL_SUFFIX.length);
                if (allChanges[newFlag]!==undefined) continue;
                flag = newFlag;
            }

            let variation = allFlags[flag];

            console.log("");
            if (things[flag]){
                stdout('(sys) killing...\n');
                things[flag].kill();
                if(things[flag].timeoutReference) {
                    clearTimeout(things[flag].timeoutReference);
                }
                things[flag] = null;
            }

            if (variation === "none") continue;

            const path = `actions${SLASH}${variation}.${SUFFIX}`;
            if (fs.existsSync(path)) {
                stderr(`Action not found: "${path}"`)
                continue;
            }

            stdout(`(sys) starting "${variation}"\n`);

            things[flag] = childProcess.exec(path);
            things[flag].stdout.on('data', stdout);
            things[flag].stderr.on('data', stderr);

            const interval = ldClient.variation(`${flag}-interval`, null);
            if(typeof interval === "number" && interval > 0) {
                stdout(`(sys) Will restart in ${interval/1000} seconds\n`);
                things[flag].timeoutReference = setTimeout(() => {
                    let update = {};
                    update[flag] = variation;
                    handleChange(update);
                }, interval);
            }

            function stdout(data) {
                process.stdout.write(`[${flag}] ${data}`);
            }

            function stderr(data) {
                process.stderr.write(`[${flag}] (stderr) ${data}`);
            }
        }
    }
});
