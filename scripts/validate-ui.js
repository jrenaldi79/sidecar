const CDP = require('chrome-remote-interface');
const fs = require('fs');

async function validateUI() {
    let client;
    try {
        client = await CDP();
        const { Page, Runtime } = client;
        await Promise.all([Page.enable(), Runtime.enable()]);

        Runtime.consoleAPICalled(({args, type}) => {
            console.log(`[Browser ${type}]`, ...args.map(a => a.value || a.description));
        });

        console.log('Connected to Electron');
        
        // Wait longer for models
        console.log('Waiting for models to load...');
        let loaded = false;
        for (let i = 0; i < 15; i++) {
            const res = await Runtime.evaluate({
                expression: '(function() { return window.ModelRegistry && window.ModelRegistry.instance && !window.ModelRegistry.instance.isLoading(); })()',
                returnByValue: true
            });
            if (res.result && res.result.value) {
                loaded = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('Models loaded:', loaded);

        // 1. Initial state
        console.log('Opening model selector dropdown...');
        await Runtime.evaluate({ expression: `document.getElementById('model-selector-display').click()` });
        await new Promise(resolve => setTimeout(resolve, 500));

        const res1 = await Runtime.evaluate({
            expression: `(function() {
                const display = document.querySelector('#model-selector-display .model-name');
                return {
                    starredCount: document.querySelectorAll('.model-option:not(.hidden)').length,
                    hasMoreLink: !!document.querySelector('.model-more-link'),
                    selectedModel: display ? display.textContent : 'unknown'
                };
            })()`,
            returnByValue: true
        });
        console.log('Initial State:', res1.result ? JSON.stringify(res1.result.value, null, 2) : 'No result');

        const screenshot1 = await Page.captureScreenshot();
        fs.writeFileSync('step1-initial-dropdown.png', Buffer.from(screenshot1.data, 'base64'));

        // 2. Click "More models"
        console.log('Clicking "More models"...');
        await Runtime.evaluate({ expression: `document.querySelector('.model-more-link').click()` });
        await new Promise(resolve => setTimeout(resolve, 500));

        const res2 = await Runtime.evaluate({
            expression: `(function() {
                const headers = Array.from(document.querySelectorAll('.model-provider-header'));
                return {
                    providerHeaders: headers.map(h => {
                        const nameEl = h.querySelector('.provider-name');
                        return nameEl ? nameEl.textContent.trim() : 'unknown';
                    }),
                    totalModels: document.querySelectorAll('.model-option').length,
                    moreContainerVisible: document.querySelector('.model-more-container').style.display !== 'none'
                };
            })()`,
            returnByValue: true
        });
        console.log('More Models State:', res2.result ? JSON.stringify(res2.result.value, null, 2) : 'No result');

        const screenshot2 = await Page.captureScreenshot();
        fs.writeFileSync('step2-more-models.png', Buffer.from(screenshot2.data, 'base64'));

        // 3. Select Gemini 3 Flash
        console.log('Selecting Gemini 3 Flash...');
        await Runtime.evaluate({
            expression: `(function() {
                const geminiOpt = Array.from(document.querySelectorAll('.model-option')).find(opt => opt.textContent.includes('Gemini 3 Flash'));
                if (geminiOpt) geminiOpt.click();
            })()`
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        const res3 = await Runtime.evaluate({
            expression: `(function() {
                const display = document.querySelector('#model-selector-display .model-name');
                const thinkingSelector = document.getElementById('thinking-selector');
                const levels = Array.from(document.querySelectorAll('#thinking-selector-dropdown .thinking-option'));
                return {
                    selectedModel: display ? display.textContent : 'unknown',
                    thinkingVisible: thinkingSelector ? thinkingSelector.style.display !== 'none' : false,
                    thinkingLevels: levels.map(o => {
                        const nameEl = o.querySelector('.thinking-name');
                        return nameEl ? nameEl.textContent : 'unknown';
                    })
                };
            })()`,
            returnByValue: true
        });
        console.log('Reasoning Model State:', res3.result ? JSON.stringify(res3.result.value, null, 2) : 'No result');

        const screenshot3 = await Page.captureScreenshot();
        fs.writeFileSync('step3-thinking-visible.png', Buffer.from(screenshot3.data, 'base64'));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        if (client) await client.close();
    }
}

validateUI();
