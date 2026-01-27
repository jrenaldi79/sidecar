const CDP = require('chrome-remote-interface');

async function listModels() {
    let client;
    try {
        client = await CDP();
        const { Runtime } = client;
        await Runtime.enable();
        
        await Runtime.evaluate({ expression: `document.getElementById('model-selector-display').click()` });
        await new Promise(resolve => setTimeout(resolve, 300));
        await Runtime.evaluate({ expression: `document.querySelector('.model-more-link').click()` });
        await new Promise(resolve => setTimeout(resolve, 300));

        const res = await Runtime.evaluate({
            expression: '(function() { return Array.from(document.querySelectorAll(".model-option")).map(o => { const el = o.querySelector(".model-name-display"); return el ? el.textContent : "unknown"; }); })()',
            returnByValue: true
        });
        console.log('Models:', res.result.value);

    } catch (err) {
        console.error(err);
    } finally {
        if (client) await client.close();
    }
}
listModels();
