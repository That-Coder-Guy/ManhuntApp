#!/usr/bin/env node
/**
 * Lets tools inside WSL talk to an iPhone plugged into Windows.
 *
 * Windows' Apple Mobile Device Service (it comes with iTunes and the Apple
 * Devices app) talks to the phone and listens on 127.0.0.1:27015, which WSL
 * can't reach. WSL can start Windows programs though, with their input and
 * output piped back. So build.sh runs this file with Windows' node.exe, once
 * per connection, and it joins that pipe to the service. Nothing is installed
 * and nothing needs administrator rights.
 */
const net = require('net');

const PORT = 27015;

const service = net.connect(PORT, '127.0.0.1');
service.on('error', (error) =>
{
    console.error(`Can't reach Apple Mobile Device Service on port ${PORT}: ${error.message}`);
    process.exit(1);
});
service.on('close', () => process.exit(0));

process.stdin.pipe(service);
service.pipe(process.stdout);
process.stdin.on('error', () => service.destroy());
process.stdout.on('error', () => service.destroy());
