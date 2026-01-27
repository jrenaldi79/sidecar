const CDP = require('chrome-remote-interface');

async function checkHTML() {
    let client;
    try {
        client = await CDP();
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: 'document.getElementById("model-selector-display").innerHTML',
            returnByValue: true
        });
        console.log('HTML:', res.result.value);

    } catch (err) {
        console.error(err);
    } finally {
        if (client) await client.close();
    }
}
checkHTML();
