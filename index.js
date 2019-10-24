const LD_CLIENTSIDE_ID = process.env['LD_CLIENTSIDE_ID'];

const FLAG_PREFIX = 'thing-';
const FLAG_INTERVAL_SUFFIX = '-interval'

const childProcess = require('child_process');
const fs = require('fs')

const asyncly = require('asyncly');
const LaunchDarkly = require('launchdarkly-node-client-sdk');
const {machineIdSync} = require('node-machine-id');
const os = require('os');
const osName = require('os-name');
const user = {
  key: machineIdSync(),
  name: os.hostname(),
  custom: {
      platform: osName()
  }
};

console.log({user});

const ldClient = LaunchDarkly.initialize(LD_SDK_KEY, user);

let things = {};
ldClient.on('ready', () => {
    ldClient.on('change', handleChange);
    handleChange(ldClient.allFlags());
    function handleChange(allChanges) {
        ldClient.identify(user);
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

            const path = `./actions/${variation}`;
            if (fs.existsSync(path)) {
                stderr(`Action not found: "${variation}"`)
                continue;
            }

            stdout(`(sys) starting "${variation}"\n`);

            things[flag] = childProcess.exec(path);
            things[flag].stdout.on('data', stdout);
            things[flag].stderr.on('data', stderr);

            const interval = ldClient.variation(`${flag}-interval`, user, null);
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
