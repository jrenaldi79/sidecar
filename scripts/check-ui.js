const CDP = require('chrome-remote-interface');

async function check() {
    let client;
    try {
        client = await CDP();
        const { Runtime } = client;
        await Runtime.enable();
        
        const res = await Runtime.evaluate({
            expression: 'document.title',
            returnByValue: true
        });
        console.log('Title:', res.result.value);
        
        const res2 = await Runtime.evaluate({
            expression: '!!document.getElementById("model-selector-display")',
            returnByValue: true
        });
        console.log('Has selector display:', res2.result.value);
        
        const res3 = await Runtime.evaluate({
            expression: 'document.querySelectorAll(".model-option").length',
            returnByValue: true
        });
        console.log('Model options count:', res3.result.value);

    } catch (err) {
        console.error(err);
    } finally {
        if (client) await client.close();
    }
}
check();
