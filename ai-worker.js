// 1. Import brain.js into the worker context
importScripts('https://unpkg.com/brain.js');

let cpuBrain = null;

self.onmessage = async function(e) {
    const data = e.data;

    // --- LOADING THE MODEL ---
    if (data.type === 'LOAD') {
        // The new Yokozuna brain handles both 4-move and 5-move loadouts automatically.
        // One universal file rules them all!
        const fileToLoad = 'yokozuna_500k.json'; 

        try {
            // Workers can use fetch!
            const response = await fetch(fileToLoad);
            const brainData = await response.json();
            
            cpuBrain = new brain.NeuralNetwork();
            cpuBrain.fromJSON(brainData.network_data);
            
            // Tell the main thread we are ready
            self.postMessage({ type: 'LOADED', file: fileToLoad });
        } catch (error) {
            self.postMessage({ type: 'ERROR', message: error.message });
        }
    }

    // --- RUNNING THE AI ---
    if (data.type === 'RUN') {
        if (!cpuBrain) {
            self.postMessage({ type: 'ERROR', message: 'Brain not loaded.' });
            return;
        }
        // This heavy math now happens completely off the main thread!
        const rawOutputs = cpuBrain.run(data.inputs);
        self.postMessage({ type: 'RESULT', outputs: rawOutputs });
    }
};