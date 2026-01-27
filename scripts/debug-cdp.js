const CDP = require('chrome-remote-interface');

async function debugCDP() {
    let client;
    try {
        client = await CDP();
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({
            expression: '({ a: 1 })',
            returnByValue: true
        });
        console.log('Result:', JSON.stringify(res, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        if (client) await client.close();
    }
}
debugCDP();
