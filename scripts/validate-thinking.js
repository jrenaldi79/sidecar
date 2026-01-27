const CDP = require('chrome-remote-interface');
const fs = require('fs');

async function validateThinkingVisibility() {
    let client;
    try {
        client = await CDP();
        const { Page, Runtime } = client;
        await Promise.all([Page.enable(), Runtime.enable()]);

        console.log('Connected to Electron');
        
        // Open dropdown and "More models"
        const setup = async () => {
            await Runtime.evaluate({ expression: `document.getElementById('model-selector-display').click()` });
            await new Promise(resolve => setTimeout(resolve, 300));
            await Runtime.evaluate({ expression: `
                const more = document.querySelector('.model-more-link');
                if (more && more.dataset.expanded === 'false') more.click();
            ` });
            await new Promise(resolve => setTimeout(resolve, 300));
        };

        // 1. Select Gemini (supports reasoning)
        console.log('Selecting Gemini 3 Flash...');
        await setup();
        await Runtime.evaluate({
            expression: `(function() {
                const opt = Array.from(document.querySelectorAll('.model-option')).find(opt => opt.textContent.includes('Gemini 3 Flash'));
                if (opt) opt.click();
            })()`
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        const res1 = await Runtime.evaluate({
            expression: `(function() {
                const el = document.querySelector('#model-selector-display .model-display-name');
                const picker = document.getElementById('thinking-selector');
                return {
                    model: el ? el.textContent : 'not found',
                    thinkingVisible: picker ? picker.style.display !== 'none' : false
                };
            })()`,
            returnByValue: true
        });
        console.log('Reasoning Model:', JSON.stringify(res1.result.value));

        // 2. Select DeepSeek (no reasoning)
        console.log('Selecting DeepSeek Chat...');
        await setup();
        await Runtime.evaluate({
            expression: `(function() {
                const opt = Array.from(document.querySelectorAll('.model-option')).find(opt => opt.textContent.includes('DeepSeek Chat'));
                if (opt) opt.click();
            })()`
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        const res2 = await Runtime.evaluate({
            expression: `(function() {
                const el = document.querySelector('#model-selector-display .model-display-name');
                const picker = document.getElementById('thinking-selector');
                return {
                    model: el ? el.textContent : 'not found',
                    thinkingVisible: picker ? picker.style.display !== 'none' : false
                };
            })()`,
            returnByValue: true
        });
        console.log('Non-Reasoning Model:', JSON.stringify(res2.result.value));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        if (client) await client.close();
    }
}

validateThinkingVisibility();
