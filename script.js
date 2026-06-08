// Prevent the browser from ever attempting to scroll the page
window.addEventListener('wheel', (e) => {
    e.preventDefault();
}, { passive: false }); // 'passive: false' is required to allow preventDefault()
// 1. Prevent Pinch-to-Zoom (Multi-touch)
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault(); // Block multi-finger taps
    }
}, { passive: false }); 

document.addEventListener('touchmove', function(event) {
    // --- THE FIX 1: Safely check for event.scale ---
    const isMultiTouch = event.touches.length > 1;
    const isZooming = event.scale !== undefined && event.scale !== 1;

    // If they are actively trying to pinch/zoom, block it everywhere
    if (isMultiTouch || isZooming) {
        event.preventDefault();
        return;
    }

    // --- THE FIX 2: The Escape Hatch ---
    // If you ever add logic to block single-finger swipes (to stop iOS rubber-banding),
    // this ensures your menus are explicitly allowed to scroll natively.
    // Adjust the selectors based on whatever UI elements need to scroll!
    if (event.target.closest('.overlay, #log-area, .division-list-container, .custom-build-container')) {
        return; // Let the browser handle the scroll natively
    }

    // (Optional) If you want to lock the game board from bouncing on single-finger swipes:
    if (event.target.closest('#game-board')) {
        event.preventDefault();
    }

}, { passive: false });

// 2. Prevent Double-Tap-to-Zoom
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault(); // Block taps that happen within 300ms of each other
    }
    lastTouchEnd = now;
}, { passive: false });

// 3. Optional: Prevent long-press context menus on the game board
const gameBoard = document.getElementById('game-board');
if (gameBoard) {
    gameBoard.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });
}

const BootManager = {
    // Determine how many major "steps" your init process has.
    // Adjust this number based on your actual setup.
    totalSteps: 10, 
    currentStep: 0,

    update: function(taskName) {
        this.currentStep++;
        const percent = Math.min(100, (this.currentStep / this.totalSteps) * 100);
        
        const bar = document.getElementById('boot-bar');
        const text = document.getElementById('boot-text');
        
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.innerText = `${taskName}...`;

        // If we hit 100%, trigger the finish sequence
        if (this.currentStep >= this.totalSteps) {
            this.finish();
        }
    },

    finish: function() {
        const text = document.getElementById('boot-text');
        if (text) text.innerText = "READY.";

        // Hold at 100% for just a fraction of a second so the player registers it finished
        setTimeout(() => {
            const loader = document.getElementById('boot-loader');
            if (loader) loader.classList.add('boot-complete');

            // --- CINEMATIC OR MENU LOGIC ---
            // Replace 'game.isFirstTimePlaying' with whatever variable you use to track new saves
            /*if (typeof game !== 'undefined' && game.isFirstTimePlaying) {
                game.playCinematicIntro();
            } else {
                // Ensure the title screen is visible and active
                const titleScreen = document.getElementById('title-screen');
                if (titleScreen) titleScreen.classList.remove('hidden');
            } */

            // Optional: Completely remove the loader from the DOM to save memory once it's invisible
            setTimeout(() => {
                if (loader) loader.remove();
            }, 1000); 

        }, 400);
    }
};

/* --- SOUND ENGINE (Web Audio API) --- */
const sound = {
    ctx: null,
    masterGain: null,
    reverbNode: null,
    enabled: true,

    init: function() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
			this.ctx.resume().then(() => { console.log("Audio Ready"); });
            
            // Master Gain for overall volume
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.5;
            this.masterGain.connect(this.ctx.destination);

            // Reverb Node (Convolver)
            this.reverbNode = this.ctx.createConvolver();
            this.reverbNode.buffer = this.createReverbBuffer();
            
            // Reverb Wet Mix
            const wetGain = this.ctx.createGain();
            wetGain.gain.value = 0.3; // Subtle reverb mix
            this.reverbNode.connect(wetGain);
            wetGain.connect(this.masterGain);
        }
		document.getElementById('achievement-overlay').onclick = () => {
			document.getElementById('achievement-overlay').classList.add('hidden');
			game.isNotifying = false;
			game.processAchievementQueue();
		};
		BootManager.update('Senses Focused...');
    },

    createReverbBuffer: function() {
        // Generate a synthetic impulse response for a "Hall/Dojo" sound
        const rate = this.ctx.sampleRate;
        const length = rate * 1.5; // 1.5 seconds tail
        const decay = 2.0;
        const buffer = this.ctx.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
            const channelData = buffer.getChannelData(c);
            for (let i = 0; i < length; i++) {
                // White noise with exponential decay
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        return buffer;
    },

    toggle: function() {
        this.enabled = !this.enabled;
        document.getElementById('sound-icon').style.opacity = this.enabled ? 1 : 0.5;
        if(this.enabled && !this.ctx) this.init();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    // Helper for creating bell-like tones with dual oscillators
    playBell: function(freq, duration, type = 'sine', vol = 0.3) {
        if (!this.enabled || !this.ctx) return;
        const t = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        
        // Primary Envelope: Instant attack, exponential decay (Bell-like)
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        
        // Connect to Master (Dry) and Reverb (Wet)
        osc.connect(gain);
        gain.connect(this.masterGain);
        gain.connect(this.reverbNode);
        
        osc.start(t);
        osc.stop(t + duration);
        
        // Secondary Oscillator for Overtone/Metallic quality
        // Only for sine/triangle to keep square/saw clean-ish but still polished
        if (type === 'sine' || type === 'triangle') {
             const osc2 = this.ctx.createOscillator();
             const gain2 = this.ctx.createGain();
             osc2.type = 'sine';
             // 2.5x frequency creates a non-harmonic metallic "ping"
             osc2.frequency.setValueAtTime(freq * 2.5, t); 
             
             gain2.gain.setValueAtTime(0, t);
             gain2.gain.linearRampToValueAtTime(vol * 0.3, t + 0.01);
             gain2.gain.exponentialRampToValueAtTime(0.001, t + (duration * 0.5)); // Decays faster
             
             osc2.connect(gain2);
             gain2.connect(this.masterGain);
             gain2.connect(this.reverbNode);
             
             osc2.start(t);
             osc2.stop(t + duration);
        }
    },

    play: function(type, pan = 0) {
        if (!this.enabled) return;
        if (!this.ctx) this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
		
		// Create a panner node for this specific sound instance
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, this.ctx.currentTime);
        panner.connect(this.masterGain);

        switch (type) {
            case 'click':
                // Soft Woodblock Tick
                this.playBell(1200, 0.1, 'triangle', 0.1);
                break;
            case 'hit_high':
                // Sharp Metallic Chime (High Attack)
                this.playBell(880, 0.8, 'sine', 0.3); // A5
                break;
            case 'hit_low':
                // Deep Gong/Bell (Low Attack)
                this.playBell(220, 1.5, 'sine', 0.4); // A3
                break;
            case 'block':
                // Resonant Deflection
                this.playBell(554, 0.5, 'triangle', 0.2); // C#5
                break;
			case 'match_start':
				// 1. ANALYZE THREAT LEVEL (Boss Check)
				let isBoss = false;
				// Check Career: Are we facing a titled rank (San'yaku) in Makuuchi?
				if (typeof game !== 'undefined' && game.mode === 'cpu' && game.currentOpponentRank) {
					if (game.career && game.career.activeBasho && game.career.activeBasho.div === 5) isBoss = true;
				}
				// Check Online: Is the opponent a Grand Champion (2000+ Hosho)?
				if (typeof net !== 'undefined' && game.mode === 'online' && net.opponentHosho >= 2000) {
					isBoss = true;
				}
				if (isBoss) {
					// --- VARIANT 6: THE YOKOZUNA (Intimidating & Ominous) ---
					// A heavy, resonant temple gong with a slow, eerie throb and cold shimmer.

					// 1. The Sub-Rumble (Low D1 - pure weight, no high harmonics to clutter)
					this.playBell(36.71, 5.0, 'triangle', 0.15); 

					// 2. The Core Strike (D2 - clean, powerful foundation)
					this.playBell(73.42, 4.5, 'sine', 0.40); 

					// 3. The Ghost Throb (Detuned exactly 1Hz from the core to create a slow, pulsing wobble)
					this.playBell(72.42, 4.5, 'sine', 0.30);

					// 4. The Cold Shimmer (Eb4 and Eb5 - A stark, distant minor 9th ringing out after the strike)
					setTimeout(() => {
						this.playBell(311.13, 3.5, 'sine', 0.15); // High, piercing tension
						this.playBell(622.25, 2.5, 'sine', 0.05); // Glassy top-end echo
					}, 600);
				} 
				else {
					// --- STANDARD VARIANTS (Select 1 of 5) ---
					// All follow the format: Root -> Harmony -> Shimmer
					const v = Math.floor(Math.random() * 5);

					switch (v) {
						case 0: 
							// ORIGINAL: The "Beckoning" (Perfect 4th: A4 -> D5)
							this.playBell(440, 2.2, 'sine', 0.3); 
							setTimeout(() => this.playBell(587.33, 2.2, 'sine', 0.25), 250);
							// Shimmer: Rising
							[1760, 2093, 2349, 2637].forEach((f, i) => setTimeout(() => this.playBell(f, 0.6, 'sine', 0.04), 600 + (i * 80)));
							break;

						case 1: 
							// VARIANT 1: The "Heroic" (Perfect 5th: A4 -> E5)
							// Feels more triumphant and stable than the 4th.
							this.playBell(440, 2.2, 'sine', 0.3);
							setTimeout(() => this.playBell(659.25, 2.2, 'sine', 0.25), 200); // E5
							// Shimmer: Wide Open Pentatonic
							[1318.5, 1760, 1975.5, 2637].forEach((f, i) => setTimeout(() => this.playBell(f, 0.6, 'sine', 0.04), 550 + (i * 90)));
							break;

						case 2: 
							// VARIANT 2: The "Mystic" (Minor 3rd: A4 -> C5)
							// A bit more serious and focused.
							this.playBell(440, 2.4, 'sine', 0.3);
							setTimeout(() => this.playBell(523.25, 2.4, 'sine', 0.25), 300); // C5
							// Shimmer: Tighter cluster, slightly slower
							[2093, 1975.5, 1760, 1568].forEach((f, i) => setTimeout(() => this.playBell(f, 0.7, 'sine', 0.04), 700 + (i * 100)));
							break;

						case 3: 
							// VARIANT 3: The "Traditional" (Major 6th: A4 -> F#5)
							// Very common interval in Japanese folk music. Airy.
							this.playBell(440, 2.0, 'sine', 0.3);
							setTimeout(() => this.playBell(739.99, 2.0, 'sine', 0.25), 250); // F#5
							// Shimmer: High and sparkly
							[2217.4, 2637, 2959.9, 3520].forEach((f, i) => setTimeout(() => this.playBell(f, 0.5, 'sine', 0.03), 500 + (i * 60)));
							break;

						case 4: 
							// VARIANT 4: The "Grounding" (Inverted 5th: E5 -> A4)
							// Starts high and settles down. Feels like "taking a stance".
							this.playBell(659.25, 2.2, 'sine', 0.25); // E5
							setTimeout(() => this.playBell(440, 2.5, 'sine', 0.35), 300); // A4 (Root lands second)
							// Shimmer: Descending cascade
							[2637, 2349, 2093, 1760].forEach((f, i) => setTimeout(() => this.playBell(f, 0.6, 'sine', 0.04), 650 + (i * 70)));
							break;
					}
				}
				break;			
            case 'win':
                // Ceremonial Chord
                const t = 0;
                setTimeout(() => this.playBell(440, 2.0, 'sine', 0.3), t);
                setTimeout(() => this.playBell(554, 2.0, 'sine', 0.3), t + 100);
                setTimeout(() => this.playBell(659, 2.5, 'sine', 0.3), t + 200);
                break;
			case 'lose':
                // Somber descending tones
                const tLose = 0;
                setTimeout(() => this.playBell(349, 1.0, 'triangle', 0.3), tLose);       // F4
                setTimeout(() => this.playBell(329, 1.0, 'triangle', 0.3), tLose + 200); // E4
                setTimeout(() => this.playBell(293, 2.5, 'triangle', 0.3), tLose + 400); // D4
                break;
            case 'powerup':
                // Rising Chime
                this.playBell(880, 0.6, 'sine', 0.1);
                setTimeout(() => this.playBell(1760, 0.6, 'sine', 0.1), 100);
                break;
			case 'powerdown':
                // Falling Chime (Penalty/Loss)
                // Starts at 880Hz and drops an octave to 440Hz
                this.playBell(880, 0.6, 'triangle', 0.1);
                setTimeout(() => this.playBell(440, 0.6, 'sine', 0.1), 100);
                break;
            case 'achievement':
                // Bright, Fast Arpeggio
                const scale = [523.25, 659.25, 783.99, 1046.50]; // C Major
                scale.forEach((f, i) => {
                    setTimeout(() => this.playBell(f, 0.8, 'triangle', 0.2), i * 80);
                });
                break;
			case 'shout':
                // Organic "Water Drop" Plop with Randomness
                const tShout = this.ctx.currentTime;
                const oscShout = this.ctx.createOscillator();
                const gainShout = this.ctx.createGain();
                
                oscShout.type = 'sine';
                
                // 1. Randomize Pitch (400Hz to 600Hz)
                // Variation simulates different voices or bubble sizes
                const startFreq = 400 + (Math.random() * 200);

                // 2. Randomize Drop Depth (150Hz to 250Hz)
                const endFreq = 150 + (Math.random() * 100);

                // 3. Randomize Speed (0.12s to 0.22s)
                // Faster = tighter pop, Slower = loose bloop
                const duration = 0.12 + (Math.random() * 0.1);

                // Apply the Pitch Bend
                oscShout.frequency.setValueAtTime(startFreq, tShout); 
                oscShout.frequency.exponentialRampToValueAtTime(endFreq, tShout + duration);
                
                // Volume Envelope
                gainShout.gain.setValueAtTime(0, tShout);
                gainShout.gain.linearRampToValueAtTime(0.08, tShout + 0.01); // Subtle Volume
                gainShout.gain.exponentialRampToValueAtTime(0.001, tShout + duration);
                
                // Connect
                oscShout.connect(gainShout);
                gainShout.connect(this.masterGain);
                gainShout.connect(this.reverbNode); 
                
                oscShout.start(tShout);
                oscShout.stop(tShout + duration + 0.1);
                break;
			case 'thwack':
                // Procedural "Whip / Sharp Crack"
                const tWhip = this.ctx.currentTime;

                // --- 1. THE WHIP (Air and Friction) ---
                // Generate a 150ms buffer of pure white noise
                const whipBufferSize = this.ctx.sampleRate * 0.15; 
                const whipBuffer = this.ctx.createBuffer(1, whipBufferSize, this.ctx.sampleRate);
                const whipOutput = whipBuffer.getChannelData(0);
                for (let i = 0; i < whipBufferSize; i++) {
                    whipOutput[i] = Math.random() * 2 - 1;
                }
                
                const whipSrc = this.ctx.createBufferSource();
                whipSrc.buffer = whipBuffer;
                
                // Bandpass filter sweeping downward creates the "swish" of the air
                const whipFilter = this.ctx.createBiquadFilter();
                whipFilter.type = 'bandpass';
                whipFilter.Q.value = 1.2;
                // Start extremely high (6000Hz) and sweep down to mid-highs (1500Hz)
                whipFilter.frequency.setValueAtTime(6000, tWhip);
                whipFilter.frequency.exponentialRampToValueAtTime(1500, tWhip + 0.1);
                
                const whipGain = this.ctx.createGain();
                // Envelope: Instant attack, incredibly fast decay so it doesn't linger
                whipGain.gain.setValueAtTime(0, tWhip);
                whipGain.gain.linearRampToValueAtTime(1.2, tWhip + 0.01); // Pushed a bit louder
                whipGain.gain.exponentialRampToValueAtTime(0.01, tWhip + 0.12); 
                
                whipSrc.connect(whipFilter);
                whipFilter.connect(whipGain);
                whipGain.connect(this.masterGain);
                whipGain.connect(this.reverbNode);
                
                whipSrc.start(tWhip);

                // --- 2. THE CRACK (The physical impact) ---
                const oscCrack = this.ctx.createOscillator();
                const gainCrack = this.ctx.createGain();
                
                // A square wave provides a harsher, thinner "click" than a sine or triangle
                oscCrack.type = 'square'; 
                
                // Pitch Envelope: Start at a screeching 3000Hz and violently drop
                oscCrack.frequency.setValueAtTime(3000, tWhip);
                oscCrack.frequency.exponentialRampToValueAtTime(500, tWhip + 0.04);
                
                // Amplitude Envelope: Exists for only 40 milliseconds
                gainCrack.gain.setValueAtTime(0, tWhip);
                gainCrack.gain.linearRampToValueAtTime(0.5, tWhip + 0.005);
                gainCrack.gain.exponentialRampToValueAtTime(0.001, tWhip + 0.04);

                oscCrack.connect(gainCrack);
                gainCrack.connect(this.masterGain);
                gainCrack.connect(this.reverbNode);
                
                oscCrack.start(tWhip);
                oscCrack.stop(tWhip + 0.05);
                break;
			case 'whiff':
                // A highly subtle, almost ignorable puff of air
                const whiffDur = 0.25; 
                const whiffOsc = this.ctx.createBufferSource();
                const whiffBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * whiffDur, this.ctx.sampleRate);
                const whiffData = whiffBuffer.getChannelData(0);
                
                // Generate pure white noise
                for (let i = 0; i < whiffBuffer.length; i++) {
                    whiffData[i] = Math.random() * 2 - 1;
                }
                whiffOsc.buffer = whiffBuffer;

                // Pass the noise through a bandpass filter to muffle it
                const whiffFilter = this.ctx.createBiquadFilter();
                whiffFilter.type = 'bandpass';
                // Sweep lower frequencies for a duller, softer sound
                whiffFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
                whiffFilter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + whiffDur);
                whiffFilter.Q.value = 0.5; // Lower resonance so it doesn't "whistle"

                // Shape the volume to be much quieter and fade faster
                const whiffGain = this.ctx.createGain();
                whiffGain.gain.setValueAtTime(0, this.ctx.currentTime);
                whiffGain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.05); // Peaks much lower
                whiffGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + whiffDur);

                // Connect the nodes: Noise -> Filter -> Volume -> Output
                whiffOsc.connect(whiffFilter);
                whiffFilter.connect(whiffGain);
                whiffGain.connect(this.masterGain || this.ctx.destination); 

                whiffOsc.start();
                break;
			case 'boom':
                // Heavy, resonant wooden/earth impact (Giant Taiko / Sign Slam)
                const tBoom = this.ctx.currentTime;

                // --- 1. THE THUD (Sub-Bass Weight) ---
                const oscLow = this.ctx.createOscillator();
                const gainLow = this.ctx.createGain();
                oscLow.type = 'sine'; // Pure heavy bass

                // Pitch Envelope: Start at a punchy mid-low (150Hz), drop quickly to earth-shaking sub (30Hz)
                oscLow.frequency.setValueAtTime(150, tBoom);
                oscLow.frequency.exponentialRampToValueAtTime(30, tBoom + 0.3);

                // Amplitude Envelope: Instant hit, long resonant decay
                gainLow.gain.setValueAtTime(0, tBoom);
                gainLow.gain.linearRampToValueAtTime(1.0, tBoom + 0.02); // Full power
                gainLow.gain.exponentialRampToValueAtTime(0.001, tBoom + 1.2);

                oscLow.connect(gainLow);
                gainLow.connect(this.masterGain);
                gainLow.connect(this.reverbNode); // Send to Dojo reverb for massive space

                oscLow.start(tBoom);
                oscLow.stop(tBoom + 1.5);

                // --- 2. THE SMACK (Wooden Transient) ---
                const oscWood = this.ctx.createOscillator();
                const gainWood = this.ctx.createGain();
                oscWood.type = 'triangle'; // Triangle gives a hollow, woody tone

                // Pitch Envelope: Sharp drop for percussive edge
                oscWood.frequency.setValueAtTime(400, tBoom);
                oscWood.frequency.exponentialRampToValueAtTime(50, tBoom + 0.1);

                // Amplitude Envelope: Fast and punchy, dies out quickly
                gainWood.gain.setValueAtTime(0, tBoom);
                gainWood.gain.linearRampToValueAtTime(0.5, tBoom + 0.01);
                gainWood.gain.exponentialRampToValueAtTime(0.001, tBoom + 0.2);

                oscWood.connect(gainWood);
                gainWood.connect(this.masterGain);
                gainWood.connect(this.reverbNode);

                oscWood.start(tBoom);
                oscWood.stop(tBoom + 0.3);

                // --- 3. THE DUST (Muffled Rumble) ---
                const rumbleBufferSize = this.ctx.sampleRate * 0.5; // 0.5 seconds of noise
                const rumbleBuffer = this.ctx.createBuffer(1, rumbleBufferSize, this.ctx.sampleRate);
                const rumbleOutput = rumbleBuffer.getChannelData(0);
                for (let i = 0; i < rumbleBufferSize; i++) {
                    rumbleOutput[i] = Math.random() * 2 - 1;
                }

                const rumbleSrc = this.ctx.createBufferSource();
                rumbleSrc.buffer = rumbleBuffer;

                // Lowpass filter muflles the white noise into a deep, earthy rumble
                const rumbleFilter = this.ctx.createBiquadFilter();
                rumbleFilter.type = 'lowpass';
                rumbleFilter.frequency.setValueAtTime(400, tBoom); // Starts muffled
                rumbleFilter.frequency.exponentialRampToValueAtTime(50, tBoom + 0.4); // Gets darker as dust settles

                const rumbleGain = this.ctx.createGain();
                rumbleGain.gain.setValueAtTime(0, tBoom);
                rumbleGain.gain.linearRampToValueAtTime(0.4, tBoom + 0.05); // Slightly slower attack than the main hit
                rumbleGain.gain.exponentialRampToValueAtTime(0.001, tBoom + 0.5);

                rumbleSrc.connect(rumbleFilter);
                rumbleFilter.connect(rumbleGain);
                // Connected only to master, NOT reverb, so it doesn't muddy up the low-end
                rumbleGain.connect(this.masterGain); 

                rumbleSrc.start(tBoom);
                break;
			case 'hair_grow':
                // Ascending rustle (bandpass filtered white noise)
                const tGrow = this.ctx.currentTime;
                const growDur = 1.5; // Matches the CSS 1.5s duration
                
                // Create white noise buffer
                const growBufferSz = this.ctx.sampleRate * growDur;
                const growBuf = this.ctx.createBuffer(1, growBufferSz, this.ctx.sampleRate);
                const growData = growBuf.getChannelData(0);
                for(let i=0; i<growBufferSz; i++) growData[i] = Math.random() * 2 - 1;
                
                const growSrc = this.ctx.createBufferSource();
                growSrc.buffer = growBuf;
                
                // Sweep a bandpass filter upwards to simulate "growing/lengthening"
                const growFilter = this.ctx.createBiquadFilter();
                growFilter.type = 'bandpass';
                growFilter.Q.value = 1.5;
                growFilter.frequency.setValueAtTime(300, tGrow); // Start low/thick
                growFilter.frequency.exponentialRampToValueAtTime(3000, tGrow + growDur); // End high/thin
                
                // Gentle swell envelope
                const growGain = this.ctx.createGain();
                growGain.gain.setValueAtTime(0, tGrow);
                growGain.gain.linearRampToValueAtTime(0.15, tGrow + 0.2); // Fade in
                growGain.gain.linearRampToValueAtTime(0.15, tGrow + growDur - 0.2); // Hold
                growGain.gain.exponentialRampToValueAtTime(0.001, tGrow + growDur); // Fade out
                
                growSrc.connect(growFilter);
                growFilter.connect(growGain);
                growGain.connect(this.masterGain);
                
                growSrc.start(tGrow);
                break;

            case 'calendar_drop':
                // Hollow, wooden 'plunk' (Triangle wave, fast pitch drop)
                const tPlunk = this.ctx.currentTime;
                const oscPlunk = this.ctx.createOscillator();
                const gainPlunk = this.ctx.createGain();
                
                oscPlunk.type = 'triangle'; 
                
                // Fast pitch drop simulates a physical knock
                oscPlunk.frequency.setValueAtTime(600, tPlunk);
                oscPlunk.frequency.exponentialRampToValueAtTime(100, tPlunk + 0.05); 
                
                // Extremely short amplitude envelope
                gainPlunk.gain.setValueAtTime(0, tPlunk);
                gainPlunk.gain.linearRampToValueAtTime(0.6, tPlunk + 0.01);
                gainPlunk.gain.exponentialRampToValueAtTime(0.001, tPlunk + 0.15);
                
                oscPlunk.connect(gainPlunk);
                gainPlunk.connect(this.masterGain);
                gainPlunk.connect(this.reverbNode); // Put it in the room
                
                oscPlunk.start(tPlunk);
                oscPlunk.stop(tPlunk + 0.2);
                break;

            case 'hair_cut':
                // Spectacular "SHINK" (Metallic scrape + Friction snip)
                const tCut = this.ctx.currentTime;
                
                // 1. The Metallic 'Shink' (High Square wave sweeping up)
                const oscShink = this.ctx.createOscillator();
                const gainShink = this.ctx.createGain();
                oscShink.type = 'square';
                oscShink.frequency.setValueAtTime(2500, tCut);
                oscShink.frequency.exponentialRampToValueAtTime(4500, tCut + 0.15); // Sheers closing
                
                gainShink.gain.setValueAtTime(0, tCut);
                gainShink.gain.linearRampToValueAtTime(0.15, tCut + 0.02);
                gainShink.gain.exponentialRampToValueAtTime(0.001, tCut + 0.25);
                
                oscShink.connect(gainShink);
                gainShink.connect(this.masterGain);
                gainShink.connect(this.reverbNode);
                
                oscShink.start(tCut);
                oscShink.stop(tCut + 0.3);

                // 2. The thick 'Snip' (Highpassed noise burst)
                const snipBufferSz = this.ctx.sampleRate * 0.1;
                const snipBuf = this.ctx.createBuffer(1, snipBufferSz, this.ctx.sampleRate);
                const snipData = snipBuf.getChannelData(0);
                for(let i=0; i<snipBufferSz; i++) snipData[i] = Math.random() * 2 - 1;
                
                const snipSrc = this.ctx.createBufferSource();
                snipSrc.buffer = snipBuf;
                
                const snipFilter = this.ctx.createBiquadFilter();
                snipFilter.type = 'highpass';
                snipFilter.frequency.value = 2000; // Remove bass so it's strictly sharp texture
                
                const snipGain = this.ctx.createGain();
                snipGain.gain.setValueAtTime(0, tCut);
                snipGain.gain.linearRampToValueAtTime(0.7, tCut + 0.01);
                snipGain.gain.exponentialRampToValueAtTime(0.001, tCut + 0.1);
                
                snipSrc.connect(snipFilter);
                snipFilter.connect(snipGain);
                snipGain.connect(this.masterGain);
                
                snipSrc.start(tCut);
                break;				
				case 'teeter':
				const tTeeter = this.ctx.currentTime;
				const oscTeeter = this.ctx.createOscillator();
				const gainTeeter = this.ctx.createGain();
				
				// Roll a random number between 0 and 3
				const teeterType = Math.floor(Math.random() * 4);
				const teeterMod = Math.floor(Math.random() * 4) * 100;

				if (teeterType === 0) {
					// --- VARIATION 0: THE ORIGINAL ---
					// Whoop Whoop Whooooo (Starts low, ramps up, drops off)
					oscTeeter.type = 'sine'; 
					oscTeeter.frequency.setValueAtTime(250, tTeeter);
					oscTeeter.frequency.exponentialRampToValueAtTime(550, tTeeter + 0.15);
					oscTeeter.frequency.setValueAtTime(250, tTeeter + 0.2);
					oscTeeter.frequency.exponentialRampToValueAtTime(550, tTeeter + 0.35);
					oscTeeter.frequency.setValueAtTime(250, tTeeter + 0.4);
					oscTeeter.frequency.exponentialRampToValueAtTime(550 + teeterMod, tTeeter + 0.6);
					oscTeeter.frequency.exponentialRampToValueAtTime(150, tTeeter + 1.2);

					gainTeeter.gain.setValueAtTime(0, tTeeter);
					gainTeeter.gain.linearRampToValueAtTime(0.35, tTeeter + 0.05); 
					gainTeeter.gain.setValueAtTime(0.35, tTeeter + 0.8); 
					gainTeeter.gain.exponentialRampToValueAtTime(0.001, tTeeter + 1.2); 
					
					oscTeeter.start(tTeeter);
					oscTeeter.stop(tTeeter + 1.3);

				} else if (teeterType === 1) {
					// --- VARIATION 1: THE FRANTIC FLAIL ---
					// 4 fast, higher-pitched panic whoops followed by a sharp drop
					oscTeeter.type = 'sine';
					[0, 0.2, 0.4, 0.6].forEach(time => {
						oscTeeter.frequency.setValueAtTime(300, tTeeter + time);
						oscTeeter.frequency.exponentialRampToValueAtTime(400 + teeterMod, tTeeter + time + 0.15);
					});
					oscTeeter.frequency.exponentialRampToValueAtTime(200, tTeeter + 0.9);

					gainTeeter.gain.setValueAtTime(0, tTeeter);
					gainTeeter.gain.linearRampToValueAtTime(0.3, tTeeter + 0.05);
					gainTeeter.gain.setValueAtTime(0.3, tTeeter + 0.7);
					gainTeeter.gain.exponentialRampToValueAtTime(0.001, tTeeter + 1.0);

					oscTeeter.start(tTeeter);
					oscTeeter.stop(tTeeter + 1.1);

				}  else if (teeterType === 2) {
					// --- VARIATION 3: THE RUBBER BAND SNAP ---
					// Pitch bends way up in suspense, wobbles slightly, then crashes down
					oscTeeter.type = 'sine';
					oscTeeter.frequency.setValueAtTime(200, tTeeter);
					oscTeeter.frequency.exponentialRampToValueAtTime(800, tTeeter + 0.4); // Stretch up
					
					// Wiggle at the top for suspense
					oscTeeter.frequency.setValueAtTime(800, tTeeter + 0.4);
					oscTeeter.frequency.linearRampToValueAtTime(750, tTeeter + 0.5);
					oscTeeter.frequency.linearRampToValueAtTime(800, tTeeter + 0.6);
					oscTeeter.frequency.linearRampToValueAtTime(750, tTeeter + 0.7);
					
					// Snap down
					oscTeeter.frequency.exponentialRampToValueAtTime(150, tTeeter + 1.0);

					gainTeeter.gain.setValueAtTime(0, tTeeter);
					gainTeeter.gain.linearRampToValueAtTime(0.35, tTeeter + 0.1);
					gainTeeter.gain.setValueAtTime(0.35, tTeeter + 0.7);
					gainTeeter.gain.exponentialRampToValueAtTime(0.001, tTeeter + 1.1);

					oscTeeter.start(tTeeter);
					oscTeeter.stop(tTeeter + 1.2);
				} else if (teeterType === 3) {
					// --- VARIATION 2: THE DIZZY DESCEND ---
					// Wobbles downward like slipping on a banana peel
					oscTeeter.type = 'sine';
					oscTeeter.frequency.setValueAtTime(400 + teeterMod, tTeeter);
					oscTeeter.frequency.exponentialRampToValueAtTime(400, tTeeter + 0.2);
					oscTeeter.frequency.setValueAtTime(300 + teeterMod, tTeeter + 0.25);
					oscTeeter.frequency.exponentialRampToValueAtTime(300, tTeeter + 0.45);
					oscTeeter.frequency.setValueAtTime(200 + teeterMod, tTeeter + 0.5);
					oscTeeter.frequency.exponentialRampToValueAtTime(200, tTeeter + 0.7);
					oscTeeter.frequency.setValueAtTime(100 + teeterMod, tTeeter + 0.75);
					oscTeeter.frequency.exponentialRampToValueAtTime(100, tTeeter + 1.1);

					gainTeeter.gain.setValueAtTime(0, tTeeter);
					gainTeeter.gain.linearRampToValueAtTime(0.3, tTeeter + 0.05);
					gainTeeter.gain.setValueAtTime(0.3, tTeeter + 0.8);
					gainTeeter.gain.exponentialRampToValueAtTime(0.001, tTeeter + 1.2);

					oscTeeter.start(tTeeter);
					oscTeeter.stop(tTeeter + 1.3);
				}

				// Common connections for all variations
				oscTeeter.connect(gainTeeter);
				gainTeeter.connect(this.masterGain);
				if (this.reverbNode) gainTeeter.connect(this.reverbNode); // Keeps the arena depth
				break;
			case 'qte_success':
                // A quick, sharp, and clean "Ding!" (Small bell + hammer strike)
                const tDing = this.ctx.currentTime;
                
                // 1. The Bell Body (Clean Sine)
                const oscDing1 = this.ctx.createOscillator();
                const gainDing1 = this.ctx.createGain();
                oscDing1.type = 'sine';
                oscDing1.frequency.setValueAtTime(1567.98, tDing); // G6 - bright and high
                
                // Extremely fast attack, very short decay (no lingering ring)
                gainDing1.gain.setValueAtTime(0, tDing);
                gainDing1.gain.linearRampToValueAtTime(0.4, tDing + 0.005); 
                gainDing1.gain.exponentialRampToValueAtTime(0.001, tDing + 0.15); 
                
                // 2. The Hammer Strike (Short Triangle for the metallic 'tink' transient)
                const oscDing2 = this.ctx.createOscillator();
                const gainDing2 = this.ctx.createGain();
                oscDing2.type = 'triangle';
                oscDing2.frequency.setValueAtTime(3135.96, tDing); // G7 - one octave up
                
                // This exists purely for the initial "hit" and dies almost instantly
                gainDing2.gain.setValueAtTime(0, tDing);
                gainDing2.gain.linearRampToValueAtTime(0.2, tDing + 0.005);
                gainDing2.gain.exponentialRampToValueAtTime(0.001, tDing + 0.05); 
                
                oscDing1.connect(gainDing1);
                oscDing2.connect(gainDing2);
                
                gainDing1.connect(this.masterGain);
                gainDing2.connect(this.masterGain);
                
                oscDing1.start(tDing);
                oscDing2.start(tDing);
                
                // Clean up the nodes quickly
                oscDing1.stop(tDing + 0.2);
                oscDing2.stop(tDing + 0.1);
                break;
			case 'qte_gold':
				// A bright, rewarding "Ka-SHING!" (Metallic strike + shimmering chord)
				const tGold = this.ctx.currentTime;
				
				// 1. The "Ka" (The Impact) - A rapid pitch-sweeping triangle wave for a sharp metallic strike
				const oscStrike = this.ctx.createOscillator();
				const gainStrike = this.ctx.createGain();
				oscStrike.type = 'triangle';
				oscStrike.frequency.setValueAtTime(1000, tGold);
				oscStrike.frequency.exponentialRampToValueAtTime(6000, tGold + 0.05); // Zip up in pitch
				
				gainStrike.gain.setValueAtTime(0, tGold);
				gainStrike.gain.linearRampToValueAtTime(0.3, tGold + 0.02);
				gainStrike.gain.exponentialRampToValueAtTime(0.001, tGold + 0.1); // Dies instantly
				
				// 2. The "SHING" (The Ring) - A bright C Major chord (C7, E7, G7)
				// Core Note (C7)
				const oscRing1 = this.ctx.createOscillator();
				const gainRing1 = this.ctx.createGain();
				oscRing1.type = 'sine';
				oscRing1.frequency.setValueAtTime(2093.00, tGold); 
				gainRing1.gain.setValueAtTime(0, tGold);
				gainRing1.gain.linearRampToValueAtTime(0.3, tGold + 0.05);
				gainRing1.gain.exponentialRampToValueAtTime(0.001, tGold + 0.7); // Long, sparkling decay
				
				// Harmony 1 (E7) - Staggered attack to create the "sweep" feel
				const oscRing2 = this.ctx.createOscillator();
				const gainRing2 = this.ctx.createGain();
				oscRing2.type = 'sine';
				oscRing2.frequency.setValueAtTime(2637.02, tGold); 
				gainRing2.gain.setValueAtTime(0, tGold);
				gainRing2.gain.linearRampToValueAtTime(0, tGold + 0.02); // Wait a tiny bit...
				gainRing2.gain.linearRampToValueAtTime(0.2, tGold + 0.08); // Then swell in
				gainRing2.gain.exponentialRampToValueAtTime(0.001, tGold + 0.6);
				
				// Harmony 2 (G7) - The highest sparkle, staggered even later
				const oscRing3 = this.ctx.createOscillator();
				const gainRing3 = this.ctx.createGain();
				oscRing3.type = 'triangle'; // Triangle adds a nice metallic bite to the top end
				oscRing3.frequency.setValueAtTime(3135.96, tGold); 
				gainRing3.gain.setValueAtTime(0, tGold);
				gainRing3.gain.linearRampToValueAtTime(0, tGold + 0.04); // Wait even longer...
				gainRing3.gain.linearRampToValueAtTime(0.2, tGold + 0.1); // Swell in
				gainRing3.gain.exponentialRampToValueAtTime(0.001, tGold + 0.5);
				
				// Connect everything
				oscStrike.connect(gainStrike); gainStrike.connect(this.masterGain);
				oscRing1.connect(gainRing1); gainRing1.connect(this.masterGain);
				oscRing2.connect(gainRing2); gainRing2.connect(this.masterGain);
				oscRing3.connect(gainRing3); gainRing3.connect(this.masterGain);
				
				// Start and Stop
				oscStrike.start(tGold); oscStrike.stop(tGold + 0.15);
				oscRing1.start(tGold);  oscRing1.stop(tGold + 0.8);
				oscRing2.start(tGold);  oscRing2.stop(tGold + 0.7);
				oscRing3.start(tGold);  oscRing3.stop(tGold + 0.6);
				
				break;
            case 'qte_fail':
                // Deep, dull, wooden "Bzzt/Thud"
                const tFail = this.ctx.currentTime;
                const oscFail = this.ctx.createOscillator();
                const gainFail = this.ctx.createGain();
                
                oscFail.type = 'sawtooth'; 
                
                // Dropped significantly lower: 90Hz plunging down to 40Hz
                oscFail.frequency.setValueAtTime(90, tFail);
                oscFail.frequency.exponentialRampToValueAtTime(40, tFail + 0.15);
                
                // Fast, blunt amplitude envelope
                gainFail.gain.setValueAtTime(0, tFail);
                gainFail.gain.linearRampToValueAtTime(0.3, tFail + 0.01);
                gainFail.gain.exponentialRampToValueAtTime(0.001, tFail + 0.2);
                
                oscFail.connect(gainFail);
                gainFail.connect(this.masterGain); 
                
                oscFail.start(tFail);
                oscFail.stop(tFail + 0.25);
                break;
			case 'card_flick':
				// The "Thwish" - Authentic, ultra-subtle card sliding on a table
				const tThwish = this.ctx.currentTime;
				
				// Slightly longer duration for the "slide" (60ms - 90ms)
				const slideDur = 0.06 + (Math.random() * 0.03); 
				
				// 1. Generate "Brown-ish" Noise (Softer and warmer than white noise)
				const noiseSz = this.ctx.sampleRate * slideDur;
				const noiseBf = this.ctx.createBuffer(1, noiseSz, this.ctx.sampleRate);
				const noiseDt = noiseBf.getChannelData(0);
				
				let lastOut = 0;
				for (let i = 0; i < noiseSz; i++) {
					let white = Math.random() * 2 - 1;
					// A simple filter to roll off harsh high frequencies
					noiseDt[i] = (lastOut + (0.02 * white)) / 1.02; 
					lastOut = noiseDt[i];
					noiseDt[i] *= 3.5; // Compensate for volume drop from the filter
				}
				
				const thwishSrc = this.ctx.createBufferSource();
				thwishSrc.buffer = noiseBf;
				
				// 2. Bandpass Filter for the "Shhh" friction texture
				const thwishFilter = this.ctx.createBiquadFilter();
				thwishFilter.type = 'bandpass';
				
				// Sweep from ~2500Hz down to ~1000Hz to give it directional "slide" motion
				const startFlickFreq = 2200 + (Math.random() * 600);
				thwishFilter.frequency.setValueAtTime(startFlickFreq, tThwish);
				thwishFilter.frequency.exponentialRampToValueAtTime(1000, tThwish + slideDur);
				thwishFilter.Q.value = 0.5; // Very wide and gentle, absolutely no whistling
				
				// 3. Subliminal Volume Envelope
				const thwishGain = this.ctx.createGain();
				thwishGain.gain.setValueAtTime(0, tThwish);
				
				// Slower attack (20ms instead of 1ms) completely removes the "hi-hat tick"
				const peakVol = 0.03 + (Math.random() * 0.02); // Extremely quiet
				thwishGain.gain.linearRampToValueAtTime(peakVol, tThwish + 0.02); 
				
				// Smooth, natural fade out
				thwishGain.gain.exponentialRampToValueAtTime(0.001, tThwish + slideDur);
				
				// Connect: Brown Noise -> Bandpass -> Volume -> Master (Dry)
				thwishSrc.connect(thwishFilter);
				thwishFilter.connect(thwishGain);
				thwishGain.connect(this.masterGain); 
				thwishGain.connect(panner);
				
				thwishSrc.start(tThwish);
				break;
        }
    }
};

class StemMusicEngine {
    constructor() {
        this.isEnabled = localStorage.getItem('sumo_music_enabled') !== 'false';
        const BASE_URL = "https://vuvrtroopers.github.io/Sumo-Will-Momentum/";
        
        this.volAmbient = 0.10; 
        this.volDrums = 0.03; 
        
		this.drumTimeSkew = 0;
        this.isMatchActive = false;
        this.matchStartTime = 0;
        this.drumDelay = 6000; 
        this.drumsTimeout = null;
        this.isLooping = false; 

        // --- THE FIX: Define these as null first ---
        this.ctx = null;
        this.filter = null;

        this.stems = {
			ambient_start: new Howl({ 
				src: [BASE_URL + 'salt_ambient_start.ogg', BASE_URL + 'salt_ambient_start.mp3'], 
				volume: 0, 
				onend: () => this._transitionToLoop() 
			}),
			drums_start: new Howl({ 
				src: [BASE_URL + 'salt_drums_start.ogg', BASE_URL + 'salt_drums_start.mp3'], 
				volume: 0 
			}),
			ambient_loop: new Howl({ 
				src: [BASE_URL + 'salt_ambient_loop.ogg', BASE_URL + 'salt_ambient_loop.mp3'], 
				volume: 0, 
				loop: true 
			}),
			drums_loop: new Howl({ 
				src: [BASE_URL + 'salt_drums_loop.ogg', BASE_URL + 'salt_drums_loop.mp3'], 
				volume: 0, 
				loop: true 
			})
		};

        // --- FIX 1: THE AUTOPLAY UNLOCKER ---
        // This listens for the VERY FIRST click anywhere on the page to start the music.
        const unlock = () => {
            // 1. Initialize the filter and routing nodes
            this.setupWebAudioNodes(); 
            
            // 2. Force the AudioContext to "Resume" (Critical for Chrome/Mobile)
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }

            this.startAmbient();
            
            window.removeEventListener('click', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('click', unlock);
        window.addEventListener('touchstart', unlock);
		
		    BootManager.update('Tuned Taiko(太鼓)...');
        this.updateUI();
    }
	
	setupWebAudioNodes() {
        if (this.filter) return;
        this.ctx = Howler.ctx;
        if (!this.ctx) return;

        // 1. The Muffle Filter (Low-pass)
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 22000;
        this.filter.Q.value = 1;

        // 2. NEW: The Sub-Bass Punch (Low-shelf)
        this.bassBoost = this.ctx.createBiquadFilter();
        this.bassBoost.type = 'lowshelf';
        this.bassBoost.frequency.value = 200; // Focus only on deep bass
        this.bassBoost.gain.value = 0; // Flat (0dB) by default

        // Route: Master -> Muffle -> BassBoost -> Speakers
        Howler.masterGain.disconnect(); 
        Howler.masterGain.connect(this.filter);
        this.filter.connect(this.bassBoost);
        this.bassBoost.connect(this.ctx.destination);
        
        console.log("[Music] Heavyweight Audio Chain Locked.");
    }

    applyImpactMuffle(intensity = 1, duration = 1500, includeSlowMo = true) {
        if (!this.isEnabled || !this.filter || !this.ctx) return;
		
		// Intensity 1.0 (Heavy Hit) shaves 2.5 seconds off the total 18s buildup.
		// Intensity 0.4 (Basic Jab) shaves about 1 second.
		const timeSkip = intensity * 2500; 
		this.drumTimeSkew += timeSkip;
        
        const now = this.ctx.currentTime;
        const startTime = performance.now();
        
        // --- 1. PREPARE THE STARTING DISTORTION ---
        // If slow-mo is disabled, start rate is 1.0 (normal pitch)
        const startRate = includeSlowMo ? Math.max(0.25, 1 - (intensity * 0.75)) : 1.0;
        const startFreq = Math.max(250, 22000 * Math.pow(0.01, intensity));
        const startQ = 1 + (intensity * 25);
        const startBass = intensity * 22;
        const startVol = this.volAmbient * (1 - (intensity * 0.5));

        // Cleanup existing loops
        if (this.muffleAnimation) cancelAnimationFrame(this.muffleAnimation);

        const animateRecovery = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(1, elapsed / duration);

            if (progress < 1) {
                // UNDERDAMPED OSCILLATION (The Wobble)
                const damping = Math.exp(-4 * progress);
                const wobble = Math.cos(progress * Math.PI * 6) * damping * intensity;

                // 1. Frequency Logic (Fog)
                const currentFreq = startFreq + (22000 - startFreq) * progress + (wobble * 3000);
                
                // 2. Rate Logic (Concussion - Only applies if includeSlowMo is true)
                const currentRate = startRate + (1 - startRate) * progress + (includeSlowMo ? (wobble * 0.15) : 0);
                
                // 3. Volume Logic (Pulse)
                const currentVol = startVol + (this.volAmbient - startVol) * progress + (wobble * 0.05);

                // --- APPLY TO WEB AUDIO NODES ---
                const audioNow = this.ctx.currentTime;
                this.filter.frequency.setValueAtTime(Math.max(200, currentFreq), audioNow);
                this.filter.Q.setValueAtTime(Math.max(1, startQ * (1 - progress)), audioNow);
                this.bassBoost.gain.setValueAtTime(Math.max(0, startBass * (1 - progress)), audioNow);

                // --- APPLY TO HOWL STEMS ---
                Object.values(this.stems).forEach(s => {
                    if (s.playing()) {
                        s.rate(Math.max(0.1, currentRate));
                        if (s === this.stems.ambient_start || s === this.stems.ambient_loop) {
                            s.volume(Math.max(0, currentVol));
                        }
                    }
                });

                this.muffleAnimation = requestAnimationFrame(animateRecovery);
            } else {
                this._resetAudioToClean();
            }
        };

        this.muffleAnimation = requestAnimationFrame(animateRecovery);
    }

    _resetAudioToClean() {
        const audioNow = this.ctx.currentTime;
        this.filter.frequency.setTargetAtTime(22000, audioNow, 0.1);
        this.filter.Q.setTargetAtTime(1, audioNow, 0.1);
        this.bassBoost.gain.setTargetAtTime(0, audioNow, 0.1);
        Object.values(this.stems).forEach(s => {
            if (s.playing()) s.rate(1);
            if (s === this.stems.ambient_start || s === this.stems.ambient_loop) s.volume(this.volAmbient);
        });
    }
	
	setConcentrationMode(active, intensity = 0.7) {
        if (!this.isEnabled || !this.filter || !this.ctx) return;

        if (active) {
            // Lock values into a "Zone" state
            this.isConcentrating = true;
            if (this.muffleAnimation) cancelAnimationFrame(this.muffleAnimation);

            const targetRate = 0.6; // Time slows down significantly
            const targetFreq = 400; // World goes very muffled
            const targetVol = this.volAmbient * 0.4;

            this.filter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.2);
            this.filter.Q.setTargetAtTime(15, this.ctx.currentTime, 0.2);
            
            Object.values(this.stems).forEach(s => {
                if (s.playing()) {
                    s.rate(targetRate);
                    if (s === this.stems.ambient_start || s === this.stems.ambient_loop) s.volume(targetVol);
                }
            });
        } else {
            // Burst back to life!
            this.isConcentrating = false;
            // We call our existing muffle recovery but start it from the "Zone" state
            // 1.2 intensity makes the "Burst" feel very energetic
            this.applyImpactMuffle(1.2, 700, true); 
        }
    }

    startAmbient() {
        if (!this.isEnabled) return;

        // Prevent restarts if already playing
        if (this.stems.ambient_start.playing() || this.stems.ambient_loop.playing()) {
            return;
        }

        // The loading gate
        if (this.stems.ambient_start.state() !== 'loaded' || this.stems.drums_start.state() !== 'loaded') {
            setTimeout(() => this.startAmbient(), 200);
            return;
        }

        this.isLooping = false;
        this.stems.ambient_start.play();
        this.stems.drums_start.play();
        this.stems.drums_start.seek(this.stems.ambient_start.seek());
        this.stems.ambient_start.fade(0, this.volAmbient, 2000);
        
        // --- THE FIX ---
        if (this.isMatchActive) {
            // If the player toggled the music on mid-match, 
            // trigger the instant drum ramp-up safely after loading!
            this.startMatchDrums(true);
        } else {
            // Otherwise, keep them muted for the menu
            this.stems.drums_start.volume(0);
        }
    }

    _transitionToLoop() {
        // Prevent double-triggering
        if (this.isLooping || this.stems.ambient_loop.playing()) return;

        if (this.stems.ambient_loop.state() !== 'loaded' || this.stems.drums_loop.state() !== 'loaded') {
            setTimeout(() => this._transitionToLoop(), 100);
            return;
        }

        this.isLooping = true;
        this.stems.ambient_loop.play();
        this.stems.drums_loop.play();
        this.stems.drums_loop.seek(this.stems.ambient_loop.seek());
        this.stems.ambient_loop.volume(this.volAmbient);
        this.stems.drums_loop.volume(this.stems.drums_start.volume());

        this.stems.ambient_start.stop();
        this.stems.drums_start.stop();
    }

    startMatchDrums(isInstant = false) {
        this.isMatchActive = true;
        this.matchStartTime = Date.now();
        this.drumTimeSkew = 0; // Reset skew for the new match
        
        if (this.drumsTimeout) clearTimeout(this.drumsTimeout);
        if (!this.isEnabled) return;

        if (isInstant) {
            // Find whoever is supposed to be playing right now
            const activeDrums = this.isLooping ? this.stems.drums_loop : this.stems.drums_start;
            if (!activeDrums.playing()) activeDrums.play();
            
            // Fade the drums in over 1 second to prevent speaker popping
            activeDrums.fade(activeDrums.volume(), this.volDrums, 1000);
        } else {
            // We use a RAF loop instead of a setTimeout for the initial delay 
            // so we can respond to the drumTimeSkew in real-time.
            const checkDelay = () => {
                if (!this.isMatchActive) return;

                const elapsed = (Date.now() - this.matchStartTime) + this.drumTimeSkew;
                
                if (elapsed >= this.drumDelay) {
                    const activeDrums = this.isLooping ? this.stems.drums_loop : this.stems.drums_start;
                    if (!activeDrums.playing()) activeDrums.play();
                    
                    // Pass the current match time so the fade knows how far along it is
                    this._exponentialFade(activeDrums, this.volDrums, 12000); 
                } else {
                    requestAnimationFrame(checkDelay);
                }
            };
            requestAnimationFrame(checkDelay);
        }
    }

	_exponentialFade(howl, targetVol, duration) {
		const fadeStartTime = Date.now();

		const ramp = () => {
			if (!this.isMatchActive || !this.isEnabled) return;

			// The "Magic" math: We add the TimeSkew to the actual elapsed time.
			const actualElapsed = Date.now() - fadeStartTime;
			const totalEffectiveElapsed = actualElapsed + this.drumTimeSkew;
			
			const progress = Math.min(1, totalEffectiveElapsed / duration);
			const easedProgress = Math.pow(progress, 2.5); 
			const currentVol = (targetVol * easedProgress);

			howl.volume(currentVol);

			if (progress < 1) {
				requestAnimationFrame(ramp);
			} else {
				console.log("[Music] Drums fully peaked due to match intensity.");
			}
		};

		requestAnimationFrame(ramp);
	}

    stopMatchDrums() {
        this.isMatchActive = false;
        if (this.drumsTimeout) clearTimeout(this.drumsTimeout);
        
        const activeDrums = this.isLooping ? this.stems.drums_loop : this.stems.drums_start;
        activeDrums.fade(activeDrums.volume(), 0, 2000);
    }

    toggle() {
        this.isEnabled = !this.isEnabled;
        localStorage.setItem('sumo_music_enabled', this.isEnabled);
        this.updateUI();

        if (this.isEnabled) {
            // We just call startAmbient. It will check if the match is active
            // and trigger the drums safely once the files are fully loaded.
            this.startAmbient();
        } else {
            this._hardStop();
        }
    }

    _hardStop() {
        if (this.drumsTimeout) clearTimeout(this.drumsTimeout);
        Object.values(this.stems).forEach(s => {
            s.fade(s.volume(), 0, 500);
            setTimeout(() => s.stop(), 600);
        });
        this.isLooping = false;
    }

    updateUI() {
        const icon = document.getElementById('music-icon');
        if (icon) icon.style.opacity = this.isEnabled ? "0.8" : "0.2";
    }	

    /**
     * Manipulates the space-time of the match.
     * rate: 1.0 is normal, 0.5 is half speed.
     */
    setPlaybackRate(rate = 1.0, transitionTime = 100) {
        if (!this.isEnabled) return;
        
        // We iterate through playing stems and shift their pitch/speed
        Object.values(this.stems).forEach(stem => {
            if (stem.playing()) {
                // Howler handles the pitch-corrected speed change natively
                stem.rate(rate); 
            }
        });

        // If we slowed down, let's automatically return to 1.0 after a delay
        if (rate !== 1.0) {
            setTimeout(() => this.setPlaybackRate(1.0), 800);
        }
    }
	
	setPracticeMode(active) {
        if (!this.isEnabled) return;

        const duration = 2000; // 2 second cross-fade
        const practiceDrumVol = 0.08; // Boosted for that "Pure Thud" feel

        const amb = this.isLooping ? this.stems.ambient_loop : this.stems.ambient_start;
        const drm = this.isLooping ? this.stems.drums_loop : this.stems.drums_start;

        if (active) {
            console.log("[Music] Entering Practice: Ambience -> Drums Crossfade");
            
            // 1. Ensure drums are playing and synced to the ambience
            if (!drm.playing()) drm.play();
            drm.seek(amb.seek());

            // 2. Cross-fade: Ambience Down, Drums Up
            amb.fade(amb.volume(), 0, duration);
            drm.fade(drm.volume(), practiceDrumVol, duration);
        } else {
            console.log("[Music] Exiting Practice: Drums -> Ambience Restore");
            
            // 3. Cross-fade back: Ambience Up, Drums Down
            amb.fade(amb.volume(), this.volAmbient, duration);
            drm.fade(drm.volume(), 0, duration);
            
            // 4. Optionally stop drums after they fade out to save resources
            setTimeout(() => {
                if (!this.isMatchActive && !this.practiceActive) drm.stop();
            }, duration + 100);
        }
    }
};

/* --- GAME CONSTANTS --- */
const MAX_MOM = 8;

const MAGE_EXP = 333;
const OCHOMAGE_EXP = 933;
const TSUYAMAGE_EXP = 1467;
const OICHOMAGE_EXP = 2000;

const MOVES = {
    // --- TIER 0 (0 Mom, 1 Dmg) ---
    'strike': { name: 'Harite',        cost: 0, dmg: 1, tier: 0, type: 'atk_high', desc: 'Harite (Slap)', icon: '👋' },
    'trip':   { name: 'Keta-geri',     cost: 0, dmg: 1, tier: 0, type: 'atk_low',  desc: 'Keta-geri (Trip)', icon: '🦶' },
    
    // --- TIER 1 (1 Mom, 3 Dmg) ---
    'sweep':  { name: 'Oshidashi',     cost: 1, dmg: 3, tier: 1, type: 'atk_high', desc: 'Oshidashi (Push)', icon: '✋' },
    'hook':   { name: 'Komatasuku',    cost: 1, dmg: 3, tier: 1, type: 'atk_low',  desc: 'Komatasuku (Kick)', icon: '⚓' },
    
    // --- TIER 2 (2 Mom, 5 Dmg) ---
    'thrust': { name: 'Uwatenage',     cost: 2, dmg: 5, tier: 2, type: 'atk_high', desc: 'Uwatenage (Throw)', icon: '🦾' },
    'twist':  { name: 'Shitatehineri', cost: 2, dmg: 5, tier: 2, type: 'atk_low',  desc: 'Shitatehineri', icon: '🌪️' },
    
    // --- TIER 3 (3 Mom, 7 Dmg) ---
    'crush':  { name: 'Yorigiri',      cost: 3, dmg: 7, tier: 3, type: 'atk_high', desc: 'Yorigiri (Force)', icon: '🐻' },
    'throw':  { name: 'Tsukaminage',   cost: 3, dmg: 7, tier: 3, type: 'atk_low',  desc: 'Tsukaminage (Lift)', icon: '💥' },
	
	// --- TIER 4 (4 Mom, 10 Dmg) ---
	'nodowa':   { name: 'Nodowa',        cost: 4, dmg: 10, tier: 4, type: 'atk_high', desc: 'Nodowa (Throat Thrust)', icon: '🖐️', guardBreak: 2 },
    'utchari':   { name: 'Utchari',       cost: 4, dmg: 10, tier: 4, type: 'atk_low', desc: 'Utchari (Spinning Throw)', icon: '🌀', guardBreak: 2 },

    // --- CORE ---
    'build':  { name: 'Build Momentum',cost: 0, dmg: 0, type: 'util',     desc: '+1 Momentum', icon: '🔋' },
    'h_block':{ name: 'High Blk',      cost: 0, dmg: 0, type: 'def_high', desc: 'Blocks High', icon: '🛡️' },
    'l_block':{ name: 'Low Blk',       cost: 0, dmg: 0, type: 'def_low',  desc: 'Blocks Low', icon: '🛡️' },
	
	// --- HIDDEN ---
	'stall': { name: 'Hesitated', type: 'flinch', cost: 0, desc: 'Failed to act in time.', icon: '⏲' }
};

const MOVE_ICONS = {
    // --- CORE ---
    'build':   `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(39, 174, 96, 0.1)" stroke="none"/><path d="M7 16l5-5 5 5"/><path d="M7 10l5-5 5 5"/></svg>`,
    'h_block': `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--p1-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 22s8-4 8-10V4l-8-3-8 3v8c0 6 8 10 8 10z" fill="rgba(44, 62, 80, 0.05)"/><path d="M12 16V8M9 11l3-3 3 3" stroke="var(--gold)" stroke-width="3"/></svg>`,
    'l_block': `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--p1-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 22s8-4 8-10V4l-8-3-8 3v8c0 6 8 10 8 10z" fill="rgba(44, 62, 80, 0.05)"/><path d="M12 8v8M9 13l3 3 3-3" stroke="var(--gold)" stroke-width="3"/></svg>`,

    // --- ATTACKS ---

    // TIER 0
    'strike': `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 11V4a2 2 0 0 0-4 0v7"/><path d="M10 11V5a2 2 0 0 0-4 0v6"/><path d="M6 11v-1a2 2 0 0 0-4 0v6a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8v-5h-2z" fill="rgba(217, 58, 58, 0.1)"/></svg>`,
    // Keta-Giri (Trip): Stylized foot profile
    'trip':   `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="12" y1="4" x2="12" y2="16" stroke-width="2" opacity="0.4"/><path d="M4 20 L14 20 L20 14" stroke-width="3"/><circle cx="12" cy="20" r="3" fill="var(--accent-red)" stroke="none"/></svg>`,
	// TIER 1
    'sweep':  `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(217, 58, 58, 0.1)" stroke="none"/><path d="M6 12h12M14 8l4 4-4 4"/><path d="M6 8h4M6 16h4" stroke-width="1.5" opacity="0.6"/></svg>`,
    // Komatasuku (Hook): Stylized leg with arrow
    'hook':   `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M16 4 V 16 A 4 4 0 0 1 8 16" stroke-width="3"/><circle cx="12" cy="12" r="2" fill="rgba(217, 58, 58, 0.2)" stroke="none"/></svg>`,
    // TIER 2
    'thrust': `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(217, 58, 58, 0.1)" stroke="none"/><path d="M6 16 C 6 4, 18 4, 18 16"/><polyline points="14 12 18 16 22 12"/></svg>`,
    // Shitatehineri (Twist): Vertical Cyclones
    'twist':  `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 4 C 18 4, 18 12, 12 12 C 6 12, 6 20, 12 20" stroke-width="3"/><path d="M16 4 L12 4 L12 8" stroke-width="2"/><path d="M8 20 L12 20 L12 16" stroke-width="2"/></svg>`,
    // TIER 3
    // Yorigiri (Crush): Compressing Forces on X
    'crush':  `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M5 4 Q 10 12, 5 20" stroke-width="3"/><path d="M19 4 Q 14 12, 19 20" stroke-width="3"/><path d="M10 10 L14 14 M14 10 L10 14" stroke-width="2"/></svg>`,
    'throw':  `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(217, 58, 58, 0.1)" stroke="none"/><path d="M20 12 A 8 8 0 0 0 8 5 l -2 3"/><polyline points="6 2 6 8 12 8"/><path d="M4 12 A 8 8 0 0 0 16 19 l 2 -3"/><polyline points="18 22 18 16 12 16"/></svg>`,
	// TIER 4
	'nodowa':   `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 2v10M8 6l4-4 4 4" /><path d="M6 16h12a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2z" fill="rgba(217, 58, 58, 0.2)"/></svg>`,
	'utchari':   `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="var(--accent-red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"><circle cx="12" cy="12" r="9" stroke-dasharray="4 2"/><path d="M12 7v10M7 12h10" /><path d="M16 16l4 4M8 8L4 4" /></svg>`
};

const BADGES = {
    // --- EXISTING BADGES ---
    'fudo_shin': { icon: '🛡️', title: 'Fudō-shin (不動心)', desc: 'Earned the Iron Wall bonus three times in one match.' },
    'hachinana': { icon: '🎋', title: 'Hachinana (ハチナナ)', desc: 'Won a bout with only one Will remaining.' },
    'yorikiri': { icon: '⚡', title: 'Yorikiri (寄り切り)', desc: 'Won a match in a single turn.' },
    'oshidashi': { icon: '🏔️', title: 'Oshidashi (押し出し)', desc: 'Won without using a Low Kimarite or a Low Block.' },
    'tsuridashi': { icon: '🏗️', title: 'Tsuri-dashi (吊り出し)', desc: 'Won using only Low Attacks and/or Low Blocks.' },
    'kimarite': { icon: '📜', title: 'Kimarite (決まり手)', desc: 'Achieved victory using all four primary kimarite techniques.' },
    'shinitai': { icon: '💀', title: 'Shini-tai (死体)', desc: 'Reduced opponent to one Will while having 3+ Momentum.' },
    'ankogata': { icon: '🐡', title: 'Ankogata (アンコ型)', desc: 'Reached maximum (Eight) Momentum in a match.' },
    'deashi': { icon: '🦶', title: 'Deashi (出足)', desc: 'Performed the same kimarite three consecutive times.' },
    'sandan_gamae': { icon: '🔱', title: 'Sandan-gamae (三段構え)', desc: 'Won after landing 3 different types of unblocked kimarite.' },
    'zambara': { icon: '💇', title: 'Zambara (乱髪)', desc: 'Completed 5 matches. Your hair is still messy, but your spirit is growing.' },
    'matta': { icon: '✋', title: 'Matta! (待った)', desc: 'Used "Build Momentum" on the very first turn of a match.' },
    'henka': { icon: '🍃', title: 'Henka (変化)', desc: 'Perfectly blocked a 3-cost Throw while you had 0 Momentum.' },
    'dohyo_giwa': { icon: '⭕', title: 'Dohyō-giwa (土俵際)', desc: 'Won a match after surviving 3 rounds with only 1 Will.' },
    'chankonabe': { icon: '🍲', title: 'Chankonabe (ちゃんこ鍋)', desc: 'Won with the Oshi-Zumo (High HP) build without dropping below 10 Will.' },
    'kachi_age': { icon: '💥', title: 'Kachi-age (勝ち上げ)', desc: 'Used a 3-cost Throw as your very first move in a match.' },
	'kinboshi': { icon: '⭐️', title: 'Kinboshi (金星)', desc: 'Defeated a Yokozuna-level opponent.' },
	'ozeki_slayer': { icon: '🛡️', title: 'Kachi-nokori (大関殺し)', desc: 'Defeated an Ozeki-level opponent.' },
	'sekiwake_slayer': { icon: '🛡️', title: 'Sekiwake Slayer', desc: 'Defeated a Sekiwake-level opponent.' },
    'mizu_iri': { icon: '💧', title: 'Mizu-iri (水入り)', desc: 'Survived a marathon match lasting 15 rounds or more.' },
    'shiko': { icon: '😤', title: 'Shiko (四股)', desc: 'Used the "Build Momentum" action 20 times total in your career.' },
    'kadoban': { icon: '🏮', title: 'Kadoban (角番)', desc: 'Won an Online Match immediately after a 3-game losing streak.' },
    'zensho_streak': { icon: '☀️', title: 'Zenshō (全勝)', desc: 'Reached a 10-match winning streak against Makushita difficulty or higher.' },
	// DIVISION MASTERY BADGES
    'master_jonokuchi': { 
        title: "Jonokuchi Graduate", 
        desc: "Proven yourself above the lowest rank. Unlocks: Komatasuku (Hook).", 
        icon: "🥉" 
    },
    'master_jonidan': { 
        title: "Jonidan Veteran", 
        desc: "Survived the grinder. Unlocks: Yorigiri (Crush).", 
        icon: "🥈" 
    },
    'master_sandanme': { 
        title: "Sandanme Star", 
        desc: "Rising through the ranks. Unlocks: Ketaguri (Trip).", 
        icon: "🥇" 
    },
    'master_makushita': { 
        title: "Makushita Master", 
        desc: "Knocking on the door of greatness. Unlocks: Shitatenhineri (Twist).", 
        icon: "🏵️" 
    },
    'master_juryo': { 
        title: "Sekitori Elite", 
        desc: "Entered the paid ranks. Unlocks: Nodowa (Thrust).", 
        icon: "💮" 
    },
    'master_makuuchi': { 
        title: "Makuuchi Conqueror", 
        desc: "Dominated the top division. Unlocks: Utchari (Spin).", 
        icon: "🏆" 
    },
	'dohyo_iri': { icon: '👏', title: 'Dohyō-iri', desc: 'Completed your first 10 matches.' },
    'rikishi':   { icon: '🥋', title: 'True Rikishi', desc: 'Completed 25 matches. You are becoming a regular.' },
    'sekitori':  { icon: '🍶', title: 'Sekitori', desc: 'Completed 50 matches. You are now a salaried professional.' },
    'oyakata':   { icon: '👴', title: 'Oyakata', desc: 'Completed 100 matches. You have the wisdom of a stablemaster.' },

    // --- MOMENTUM USAGE (Spirit) ---
    'teppo':     { icon: '🪵', title: 'Teppo', desc: 'Used "Build Momentum" 50 times. Your hands are hardening.' },
    'matawari':  { icon: '🤸', title: 'Matawari', desc: 'Used "Build Momentum" 100 times. Flexible body, flexible mind.' },
    'sonkyo':    { icon: '🧘', title: 'Sonkyo', desc: 'Used "Build Momentum" 200 times. Respect before and after the bout.' },
    'tamashii':  { icon: '🔥', title: 'Tamashii', desc: 'Used "Build Momentum" 500 times. Your spirit burns eternal.' },

    // --- TOTAL WINS (Conquest) ---
    'kachi_koshi': { icon: '⚪', title: 'Kachi-koshi', desc: 'Accumulated 10 Total Wins across all modes.' },
    'yusho':       { icon: '🏆', title: 'Yusho', desc: 'Accumulated 50 Total Wins. A true champion.' },

    // --- COMPENSATORY (Pity/Resilience) ---
    'make_koshi':  { icon: '🩹', title: 'Make-koshi', desc: 'Lost 5 matches in a row. Fall down seven times, stand up eight.' },
    'gaman':       { icon: '😣', title: 'Gaman', desc: 'Lost 10 matches in a row. Endurance is a weapon.' },
    'butsukari':   { icon: '🤕', title: 'Butsukari', desc: 'Took 500 points of damage total in your career. Your skin is tough.' },
    'salt_toss':   { icon: '🧂', title: 'Kiyome-shio', desc: 'Purify the ring. Played 5 matches in a row without a single win.' },
	// --- DOHYO UNLOCKS ---
    'basho_fire': { icon: '🔥', title: 'Lord of the Ring', desc: 'Won an online tournament featuring at least 8 human players.' },
    'perfect_balance': { icon: '⚖️', title: 'Flawless Recovery', desc: 'Achieved a perfect Balance Check by hitting only Gold Zones.' },
    'hosho_2000': { icon: '❄️', title: 'Cold Hard Cash', desc: 'Accumulated 2,000 Hōshōkin.' },
	// --- BALANCE CHECK BADGES (Resilience) ---
    'balance_1':   { icon: '🦶', title: 'Finding Your Feet', desc: 'Passed your first Balance Check.' },
    'balance_10':  { icon: '🧘', title: 'Steady Core', desc: 'Passed 10 Balance Checks.' },
    'balance_25':  { icon: '🌳', title: 'Unshakable', desc: 'Passed 25 Balance Checks.' },
    'balance_50':  { icon: '🏔️', title: 'Rooted to the Earth', desc: 'Passed 50 Balance Checks.' },
    'balance_100': { icon: '🪨', title: 'Master of the Edge', desc: 'Passed 100 Balance Checks.' },
    'balance_250': { icon: '🪐', title: 'Gravity Defier', desc: 'Passed 250 Balance Checks. You are an immovable object.' },

    // --- PERFECT DIVISION CLEARS (Champions) ---
    'champ_jonokuchi': { icon: '🌸', title: 'Flawless Novice', desc: 'Achieved a perfect Zensho-yusho (0 losses) in the Jonokuchi division.' },
    'champ_jonidan':   { icon: '🎋', title: 'Unbeaten Stepper', desc: 'Achieved a perfect Zensho-yusho in the Jonidan division.' },
    'champ_sandanme':  { icon: '⛩️', title: 'Sandanme Sovereign', desc: 'Achieved a perfect Zensho-yusho in the Sandanme division.' },
    'champ_makushita': { icon: '🐯', title: 'Makushita Monarch', desc: 'Achieved a perfect Zensho-yusho in the Makushita division.' },
    'champ_juryo':     { icon: '🐉', title: 'Sekitori Supremacy', desc: 'Achieved a perfect Zensho-yusho in the Juryo division.' },
    'champ_makuuchi':  { icon: '👑', title: 'God of the Dohyo', desc: 'Achieved a perfect Zensho-yusho in the Makuuchi division. You are a living legend.' },
	
	// --- CARD RELATED ACHIEVEMENTS ---
	// --- HAND COMPOSITION ---
    'goshiki': { icon: '🌈', title: 'Goshiki (五色)', desc: 'Held a hand containing one card of every rarity (Common, Rare, Epic, Legendary).' },
    'shin_gi_tai': { icon: '🧘', title: 'Shin-Gi-Tai (心技体)', desc: 'Held a hand composed entirely of Legendary cards.' },
    'kihon': { icon: '📜', title: 'Kihon (基本)', desc: 'Won a match using a deck containing only Common cards.' },
    'hyakuman': { icon: '🃏', title: 'Hyakuman (百万)', desc: 'Had 8 or more cards in your hand at once.' },

    // --- DISCARD & CYCLING (THE SPIRIT) ---
    'shunshin': { icon: '🌬️', title: 'Shunshin (瞬身)', desc: 'Cycled 5 or more cards in a single turn.' },
    'aizome': { icon: '🌀', title: 'Aizome (藍染)', desc: 'Triggered the Waki-Ga-Katai cycle bonus three times in one match.' },
    'soji': { icon: '🧹', title: 'Ōsōji Master', desc: 'Used the Ōsōji (Sweep) card to discard a hand of 8 cards or more.' },
    'tenpuku': { icon: '🔄', title: 'Tenpuku (転覆)', desc: 'Used Shikiri-naoshi to reset an opponent’s hand when they had 5+ cards.' },

    // --- HOLD & DURATION (THE POSTURE) ---
    'kongō_riki': { icon: '🗿', title: 'Kongō-riki (金剛力)', desc: 'Had 3 or more Hold effects active simultaneously.' },
    'nio_mon': { icon: '⛩️', title: 'Niō-mon (仁王門)', desc: 'Had both A-gyō and Un-gyō active at the same time.' },
    'fudo_no_kami': { icon: '⛰️', title: 'Fudō no Kami', desc: 'Doubled an Iron Wall effect using Kimedashi.' },
    'taka_no_me': { icon: '🦅', title: 'Taka no Me (鷹の目)', desc: 'Used Mawashi-Grip to prevent a Guard Break from a heavy kamarite.' },

    // --- COMBOS & RECOVERY (THE FLOW) ---
    'manpuku': { icon: '🍱', title: 'Manpuku (満腹)', desc: 'Drew 4 or more cards in a single turn through Chankonabe or Discard effects.' },
    'tobiuo': { icon: '🐟', title: 'Tobiuo (飛び魚)', desc: 'Recovered Will using Hassotobi while you were at 1 HP.' },
    'kaeshi_waza': { icon: '↩️', title: 'Kaeshi-waza (返し技)', desc: 'Won a bout through the recoil damage of the Soppugata Hold effect.' },
    'hyōhyō': { icon: '☁️', title: 'Hyōhyō (飄々)', desc: 'Won a match without ever manually cycling (discarding) a card.' },

    // --- COLLECTION & META (THE LEGEND) ---
    'hanshin': { icon: '🐯', title: 'Hanshin Spirit', desc: 'Recycled 50 cards through the Saito Goma fire ceremony.' },
    'makimono': { icon: '📜', title: 'Makimono (巻物)', desc: 'Unlocked every type of Resource Card in the game.' },
    'onibi': { icon: '👻', title: 'Onibi (鬼火)', desc: 'Won a match where your Draw Pile and Discard Pile were both completely empty.' },
    'keiko_master': { icon: '🥋', title: 'Keiko Master', desc: 'Activated a "Hold" effect for 5 consecutive turns.' }
};

const COSMETICS = {
    // MAWASHI (Belt)
    'maw_default': { type: 'mawashi', name: 'Standard Black', class: '', req: null, icon: '⚫' },
    'maw_blue':    { type: 'mawashi', name: 'Ocean Blue', class: 'mawashi-blue', req: 'oshidashi', icon: '🔵' },
    'maw_red':     { type: 'mawashi', name: 'Battle Red', class: 'mawashi-red', req: 'kachi_age', icon: '🔴' },
    'maw_green':   { type: 'mawashi', name: 'Forest Green', class: 'mawashi-green', req: 'fudo_shin', icon: '🟢' },
    'maw_white':   { type: 'mawashi', name: 'Training White', class: 'mawashi-training', req: 'zambara', icon: '⚪' },
    'maw_caution': { type: 'mawashi', name: 'Hazard', class: 'mawashi-caution', req: 'matta', icon: '🚧' },
    'maw_arrows':  { type: 'mawashi', name: 'Chevron', class: 'mawashi-arrows', req: 'deashi', icon: '⏩' },
    'maw_star':    { type: 'mawashi', name: 'Stardust', class: 'mawashi-star', req: 'kinboshi', icon: '⭐' },
    'maw_bone':    { type: 'mawashi', name: 'Ronin', class: 'mawashi-bone', req: 'shinitai', icon: '☠️' },
	'maw_purple': { type: 'mawashi', name: 'Imperial Purple', class: 'mawashi-purple-glow', req: 'zensho_streak', icon: '💜' },
	'maw_gold':    { type: 'mawashi', name: 'Grand Champion', class: 'mawashi-gold', req: 'kinboshi', icon: '🏆' },
    'maw_ghost':   { type: 'mawashi', name: 'Yūrei', class: 'mawashi-ghost', req: 'henka', icon: '👻' },
	'maw_clay':     { type: 'mawashi', name: 'Clay', class: 'mawashi-clay', req: 'dohyo_iri', icon: '🟤' },
    'maw_silk':     { type: 'mawashi', name: 'Finest Silk', class: 'mawashi-silk', req: 'sekitori', icon: '👘' },
    'maw_victory':  { type: 'mawashi', name: 'Victory Orange', class: 'mawashi-victory', req: 'kachi_koshi', icon: '🟠' },
    'maw_ruby':     { type: 'mawashi', name: 'Imperial Ruby', class: 'mawashi-ruby', req: 'yusho', icon: '♦️' },
    'maw_wood':     { type: 'mawashi', name: 'Oak', class: 'mawashi-wood', req: 'teppo', icon: '🪵' },
    'maw_thunder':  { type: 'mawashi', name: 'Raijin', class: 'mawashi-thunder', req: 'sonkyo', icon: '⚡' },
    'maw_ragged':   { type: 'mawashi', name: 'Tattered', class: 'mawashi-ragged', req: 'make_koshi', icon: '🧣' },
	'maw_ozeki': { type: 'mawashi', name: 'Ozeki Silver', class: 'mawashi-ozeki', req: 'ozeki_slayer', icon: '🥈' },
	'maw_sekiwake': { type: 'mawashi', name: 'Sekiwake Bronze', class: 'mawashi-sekiwake', req: 'sekiwake_slayer', icon: '🥉' },
    'maw_grip':     { type: 'mawashi', name: 'Athletic Tape', class: 'mawashi-grip', req: 'balance_1', icon: '🩹' },
    'maw_rope':     { type: 'mawashi', name: 'Shimenawa', class: 'mawashi-rope', req: 'balance_10', icon: '🪢' },
    'maw_obsidian': { type: 'mawashi', name: 'Obsidian Glass', class: 'mawashi-obsidian', req: 'balance_50', icon: '⬛' },
    'maw_sakura':   { type: 'mawashi', name: 'Falling Sakura', class: 'mawashi-sakura', req: 'champ_jonokuchi', icon: '🌸' },
    'maw_shrine':   { type: 'mawashi', name: 'Vermilion Torii', class: 'mawashi-shrine', req: 'champ_sandanme', icon: '⛩️' },
    'maw_dragon':   { type: 'mawashi', name: 'Dragon Scales', class: 'mawashi-dragon', req: 'champ_juryo', icon: '🐉' },
    
    // SKINS (Body)
    'skin_default':{ type: 'skin', name: 'Natural', class: '', req: null, icon: '🙂' },
    'skin_sumo':   { type: 'skin', name: 'Fighting Spirit', class: 'skin-sumo-red', req: 'ankogata', icon: '😡' },
    'skin_stone':  { type: 'skin', name: 'Iron Skin', class: 'skin-stone', req: 'fudo_shin', icon: '🗿' },
    'skin_water':  { type: 'skin', name: 'River', class: 'skin-water', req: 'mizu_iri', icon: '💧' },
    'skin_magma':  { type: 'skin', name: 'Volcanic', class: 'skin-magma', req: 'dohyo_giwa', icon: '🌋' },
    'skin_phoenix':{ type: 'skin', name: 'Phoenix', class: 'skin-phoenix', req: 'kadoban', icon: '🔥' },
    'skin_diamond':{ type: 'skin', name: 'Diamond', class: 'skin-diamond', req: 'zensho', icon: '💎' },
	'skin_tan':     { type: 'skin', name: 'Deep Tan', class: 'skin-tan', req: 'rikishi', icon: '😎' },
    'skin_gold':    { type: 'skin', name: 'Living Statue', class: 'skin-gold', req: 'oyakata', icon: '🔱' },
    'skin_jade':    { type: 'skin', name: 'Jade', class: 'skin-jade', req: 'matawari', icon: '🟢' },
    'skin_cosmic':  { type: 'skin', name: 'Cosmic', class: 'skin-cosmic', req: 'tamashii', icon: '🌌' },
    'skin_scarred': { type: 'skin', name: 'Battle Worn', class: 'skin-scarred', req: 'gaman', icon: '🩹' },
    'skin_iron':    { type: 'skin', name: 'Iron Body', class: 'skin-iron', req: 'butsukari', icon: '⛓️' },
    'skin_salt':    { type: 'skin', name: 'Purified', class: 'skin-salt', req: 'salt_toss', icon: '🧂' },
	'skin_bark':     { type: 'skin', name: 'Ancient Oak', class: 'skin-bark', req: 'balance_25', icon: '🌳' },
    'skin_kintsugi': { type: 'skin', name: 'Kintsugi Marble', class: 'skin-kintsugi', req: 'balance_100', icon: '🪨' },
    'skin_astral':   { type: 'skin', name: 'Astral Projection', class: 'skin-astral', req: 'balance_250', icon: '🪐' },
    'skin_bamboo':   { type: 'skin', name: 'Iron Bamboo', class: 'skin-bamboo', req: 'champ_jonidan', icon: '🎋' },
    'skin_tiger':    { type: 'skin', name: 'Tiger Spirit', class: 'skin-tiger', req: 'champ_makushita', icon: '🐯' },
    'skin_kami':     { type: 'skin', name: 'Living Kami', class: 'skin-kami', req: 'champ_makuuchi', icon: '👑' },
	
	// DOHYO (Ring Themes)
    'dohyo_default': { type: 'dohyo', name: 'Traditional Straw', class: '', req: null, icon: '🌾' },
    'dohyo_fire':    { type: 'dohyo', name: 'Ring of Fire', class: 'dohyo-fire', req: 'basho_fire', icon: '🔥' },
    'dohyo_ice':     { type: 'dohyo', name: 'Black Ice', class: 'dohyo-ice', req: 'perfect_balance', icon: '❄️' },
    'dohyo_neon':    { type: 'dohyo', name: 'Cyber-Dojo', class: 'dohyo-neon', req: 'hosho_2000', icon: '⚡' },
	// CARD RELATED COSMETICS
	// MAWASHI
    'maw_indigo': { type: 'mawashi', name: 'Aizome Blue', class: 'mawashi-aizome', req: 'aizome', icon: '🌀' },
    'maw_scroll': { type: 'mawashi', name: 'Strategy Scroll', class: 'mawashi-scroll', req: 'goshiki', icon: '📜' },
    'maw_flame':  { type: 'mawashi', name: 'Goma Embers', class: 'mawashi-goma', req: 'hanshin', icon: '🔥' },
    'maw_oni':    { type: 'mawashi', name: 'Oni Horn', class: 'mawashi-oni', req: 'shunshin', icon: '👹' },
    'maw_paper':  { type: 'mawashi', name: 'Washi Paper', class: 'mawashi-paper', req: 'soji', icon: '📄' },
    'maw_mirror': { type: 'mawashi', name: 'Mirror Shine', class: 'mawashi-mirror', req: 'shin_gi_tai', icon: '🪞' },
    'maw_leaf':   { type: 'mawashi', name: 'Autumn Leaf', class: 'mawashi-leaf', req: 'hyōhyō', icon: '🍂' },
    
    // SKINS
    'skin_ink':     { type: 'skin', name: 'Sumi-e Ink', class: 'skin-ink', req: 'kihon', icon: '🖌️' },
    'skin_statue':  { type: 'skin', name: 'Temple Guardian', class: 'skin-statue', req: 'nio_mon', icon: '🏛️' },
    'skin_porcelain':{ type: 'skin', name: 'Porcelain', class: 'skin-porcelain', req: 'fudo_no_kami', icon: '🏺' },
    'skin_copper':  { type: 'skin', name: 'Aged Copper', class: 'skin-copper', req: 'keiko_master', icon: '🥉' },
    'skin_spirit':  { type: 'skin', name: 'Ethereal Flow', class: 'skin-spirit', req: 'tobiuo', icon: '👻' },
    'skin_monk':    { type: 'skin', name: 'Sohei', class: 'skin-monk', req: 'kongō_riki', icon: '📿' },
    'skin_tapestry':{ type: 'skin', name: 'Woven Tale', class: 'skin-tapestry', req: 'makimono', icon: '🧶' },

    // DOHYO
    'dohyo_tatami': { type: 'dohyo', name: 'Zen Tatami', class: 'dohyo-tatami', req: 'hyōhyō', icon: '🎎' },
    'dohyo_night':  { type: 'dohyo', name: 'Midnight Garden', class: 'dohyo-night', req: 'onibi', icon: '🌃' },
    'dohyo_scroll': { type: 'dohyo', name: 'Great Scroll', class: 'dohyo-scroll', req: 'hyakuman', icon: '📜' }
};
window.COSMETICS = COSMETICS;

const particleSystem = {
    // Configs map to the CSS class names of your premium skins
    configs: {
        'skin-salt':   { count: 15, class: 'part-salt',   minV: 20, maxV: 50, gravity: 35 }, /* Drops down heavily */
        'skin-gold':   { count: 12, class: 'part-gold',   char: '✦', minV: 30, maxV: 80, gravity: 0 },  /* Explodes outward */
        'skin-jade':   { count: 10, class: 'part-jade',   minV: 20, maxV: 60, gravity: -20 }, /* Floats up like magic */
        'skin-cosmic': { count: 15, class: 'part-cosmic', char: '✨', minV: 40, maxV: 90, gravity: 0 }  /* Fast straight lines */
    },

    emit: function(skinClass, playerId) {
        const config = this.configs[skinClass];
        if (!config) return; // If it's a normal skin, do nothing!

        const arena = document.querySelector('.rikishi-container');
        if (!arena) return;

        // 1. Create a container for this burst
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.width = '60px';
        container.style.height = '60px';
        container.style.top = '50%';
        container.style.transform = 'translateY(-50%)';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '50'; // Above the ring, behind the UI

        // Align the burst center to P1 or P2
        if (playerId === 'p1-rikishi') {
            container.style.left = '40px'; 
        } else {
            container.style.right = '40px';
        }

        arena.appendChild(container);

        // 2. Generate the physics for each particle
        for (let i = 0; i < config.count; i++) {
            const p = document.createElement('div');
            p.className = `premium-particle ${config.class}`;
            p.innerText = config.char || '';
            
            // Randomize trajectories
            const angle = Math.random() * Math.PI * 2;
            const velocity = config.minV + Math.random() * (config.maxV - config.minV);
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity + config.gravity;
            const rot = Math.random() * 360;
            
            // Pass the math to CSS via custom properties
            p.style.setProperty('--tx', `${tx}px`);
            p.style.setProperty('--ty', `${ty}px`);
            p.style.setProperty('--rot', `${rot}deg`);
            
            // Slight random delay so they don't look perfectly uniform
            p.style.animationDelay = `${Math.random() * 0.15}s`;
            
            container.appendChild(p);
        }

        // 3. Clean up the DOM after the animation finishes
        setTimeout(() => {
            if (container.parentNode) container.parentNode.removeChild(container);
        }, 1500);
    }
};

const gyoji = {
    flavorTimeout: null,
    idleTimeout: null,
    countdownInterval: null,
    
    // Core function to display text
    shout: function(text, duration = 2000) {
        const layer = document.getElementById('gyoji-layer');
        if (!layer) return;

        // Clear any existing shouts immediately
        layer.innerHTML = '';

        // 1. Create the Wrapper (Handles the shadow and the hinge animation)
        const wrapper = document.createElement('div');
        wrapper.className = 'gyoji-wrapper gyoji-enter';

        // 2. Create the Bubble (Handles the white background and jagged shape)
        const bubble = document.createElement('div');
        bubble.className = 'gyoji-shout';
        bubble.innerText = text;
        
        // Nest them together
        wrapper.appendChild(bubble);
        layer.appendChild(wrapper);
        
        if (typeof sound !== 'undefined') sound.play('shout');

        // Remove it after duration
        setTimeout(() => {
            wrapper.classList.remove('gyoji-enter');
            wrapper.classList.add('gyoji-exit');
            
            // Clean up DOM after animation finishes
            setTimeout(() => {
                if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
            }, 300);
        }, duration);
    },

    // Call this when the player needs to think (starts the timer)
    startIdleTimer: function() {
        this.stopIdleTimer(); // Clear existing to avoid duplicates
        
        // --- 1. FLAVOR TEXT GENERATOR (Runs in all modes) ---
        // Shouts a random historical phrase if the player is thinking for a while
        const startFlavorLoop = () => {
            this.flavorTimeout = setTimeout(() => {
                const phrases = [
                    "NOKOTTA!",
                    "NOKOTTA! NOKOTTA!",
                    "HAKKEYOI!",
                    "HAKKEYOI! NOKOTTA!", 
                    "MATTA NASHI!"       /* "No Waiting!" */
                ];
                
                // Pick a random phrase
                const phrase = phrases[Math.floor(Math.random() * phrases.length)];
                this.shout(phrase, 1500);
                
                // Restart timer so he keeps yelling if they keep waiting
                startFlavorLoop(); 
            }, 15000); // Set to 15 seconds (adjust to your liking!)
        };
        startFlavorLoop();

        // --- 2. STRICT ONLINE COUNTDOWN ---
        // Only apply the strict clock and force a move in Online Mode!
        if (typeof game !== 'undefined' && game.mode === 'online') {

            // --- BLITZ MODE LOGIC ---
            // Default to 10 seconds of silence, but drop to 0 if Blitz is active
            let silenceDelay = 10000;
            if (typeof net !== 'undefined' && net.matchRules && net.matchRules.isBlitz) {
                silenceDelay = 0; 
            }

            // Phase 1: Wait the designated silence duration
            this.idleTimeout = setTimeout(() => {
                // IMPORTANT: Stop the flavor loop so it doesn't overlap with the countdown!
                if (this.flavorTimeout) clearTimeout(this.flavorTimeout);

                let seconds = 5;
                
                // Phase 2: Start the 5-second countdown
                this.shout(`五 5...`, 900);
                seconds--;

                this.countdownInterval = setInterval(() => {
                    if (seconds === 4) this.shout(`四 4...`, 900);
                    else if (seconds === 3) this.shout(`三 3...`, 900);
                    else if (seconds === 2) this.shout(`二 2...`, 900);
                    else if (seconds === 1) this.shout(`一 1...`, 900);
                    else if (seconds === 0) {
                        this.stopIdleTimer();
                        this.shout("⏰ TIME UP! ⏰", 1000);
                        
                        // Force the stalling player to make a dud move
                        if (typeof game !== 'undefined' && typeof game.forceStallMove === 'function') {
                            game.forceStallMove();
                        }
                    }
                    seconds--;
                }, 1000);
                
            }, silenceDelay); 
        }
    },

    // Call this when a move is made or game ends (stops the timer)
    stopIdleTimer: function() {
        if (this.flavorTimeout) {
            clearTimeout(this.flavorTimeout);
            this.flavorTimeout = null;
        }
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    },
    
    // --- THE GUNBAI ---
    showGunbai: function(winner) {
        // Ensure the layer exists
        let layer = document.getElementById('gunbai-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'gunbai-layer';
            document.body.appendChild(layer);
        }
        layer.innerHTML = ''; 

        const gunbai = document.createElement('div');
        // Pointing logic: P1 (Left/West), P2 (Right/East)
        const directionClass = winner === 'p1' ? 'point-west' : 'point-east';
        gunbai.className = `gunbai-graphic ${directionClass}`;

        // SVG mimicking the historical reference photo
        gunbai.innerHTML = `
            <svg viewBox="0 0 200 450" width="100%" height="100%" style="filter: drop-shadow(5px 15px 10px rgba(0,0,0,0.5));">
                <path d="M 100 370 Q 140 410 110 450" stroke="#8b2500" fill="none" stroke-width="5" stroke-linecap="round"/>
                <path d="M 100 370 Q 60 410 90 450" stroke="#8b2500" fill="none" stroke-width="5" stroke-linecap="round"/>
                <circle cx="100" cy="370" r="9" fill="#8b2500" />
                
                <rect x="85" y="200" width="30" height="180" fill="#8B4513" rx="5" />
                
                <rect x="82" y="200" width="36" height="20" fill="#222" rx="2" />
                <rect x="82" y="350" width="36" height="25" fill="#222" rx="2" />
                
                <rect x="85" y="240" width="30" height="6" fill="#daa520" />
                <rect x="85" y="290" width="30" height="6" fill="#daa520" />
                
                <path d="M 20 60 C 50 5, 150 5, 180 60 C 200 110, 180 180, 100 210 C 20 180, 0 110, 20 60 Z" fill="#151515" stroke="#daa520" stroke-width="4" stroke-linejoin="round"/>
                
                <path d="M 30 70 C 55 25, 145 25, 170 70 C 185 105, 170 170, 100 195 C 30 170, 15 105, 30 70 Z" fill="none" stroke="#daa520" stroke-width="2" stroke-dasharray="4 6" opacity="0.8"/>
                
                <circle cx="100" cy="115" r="45" stroke="#daa520" fill="none" stroke-width="1.5" opacity="0.6"/>
                
                <text x="100" y="105" fill="#daa520" font-family="serif" font-size="28" text-anchor="middle" font-weight="bold" letter-spacing="2">軍</text>
                <text x="100" y="145" fill="#daa520" font-family="serif" font-size="28" text-anchor="middle" font-weight="bold" letter-spacing="2">配</text>
            </svg>
        `;

        layer.appendChild(gunbai);
        
        // 3.5s total animation * 50% keyframe = 1750ms delay
        setTimeout(() => {
            // Check if sound engine is available and enabled
            if (typeof sound !== 'undefined' && sound.enabled) {
                sound.play('thwack');
            }
        }, 1225);

        // Auto-cleanup DOM after animation
        setTimeout(() => {
            if (layer.contains(gunbai)) gunbai.remove();
        }, 4000);
    }
};

let cpuBrain = null;

/* --- CLOUD DATABASE SETUP --- */
const firebaseConfig = {
	apiKey: "AIzaSyBAE0GQpqpQP1Nxqzt3d0Xq6jK5qaIav2I",
	authDomain: "sumo-will-and-momentum.firebaseapp.com",
	projectId: "sumo-will-and-momentum",
	storageBucket: "sumo-will-and-momentum.firebasestorage.app",
	messagingSenderId: "262386151095",
	appId: "1:262386151095:web:19e253afc53b3be2d3e732",
	measurementId: "G-XMFY6DQ851"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
BootManager.update('Firebase Initialized.');
const auth = firebase.auth();
BootManager.update('Firebase Authorized.');
const db = firebase.firestore();
BootManager.update('Firestore DataBase Loaded.');
const googleProvider = new firebase.auth.GoogleAuthProvider();
BootManager.update('Google APIs Loaded.');

// Listen for login/logout state changes automatically
window.currentUserUID = null; // Bind to window so the net object can easily grab it

// Listen for login/logout state changes automatically
auth.onAuthStateChanged(user => {
    if (user) {
        window.currentUserUID = user.uid;
        
        // Use displayName if Google Auth, otherwise default to "Guest" for anonymous
        const playerName = user.displayName || "Guest";
        console.log(`🌸 Logged in as: ${playerName} (${user.uid})`);
        
        // 1. Pull their save data
        if (typeof game !== 'undefined' && game.pullFromCloud) {
            game.pullFromCloud();
			// --- NEW: RAGE QUIT CATCHER ---
            setTimeout(() => {
                const guardValue = localStorage.getItem('sumo_rage_quit_guard');
                if (guardValue !== null) {
                    const myHosho = game.career.hosho_kin || 0;
                    
                    // Calculate their exact penalty using the Tier Floor logic
                    let penalty = 25;
                    const myFloor = Math.floor(myHosho / 500) * 500;
                    if (myHosho - penalty < myFloor) {
                        penalty = Math.max(0, myHosho - myFloor);
                    }

                    // Apply the penalties
                    game.career.hosho_kin -= penalty;
                    game.career.stats.loss_streak = (game.career.stats.loss_streak || 0) + 1;
                    if (game.onlineStreak) game.onlineStreak = 0;
                    
                    game.saveCareer(); // Force sync to Firebase
                    localStorage.removeItem('sumo_rage_quit_guard');
                    
                    // Publicly shame them on their own screen
                    alert(`DISHONORABLE DISCONNECT\nYou abandoned your last online match. Penalty: -${penalty}¥ Hōshōkin.`);
                }
            }, 1000);
        }

        // 2. NOW it is safe to start listening for invites!
        if (typeof net !== 'undefined' && net.listenForInvites) {
            net.listenForInvites();
        }

    } else {
        window.currentUserUID = null;
        console.log("Disconnected from Cloud. Attempting anonymous login...");
        
        // Fallback: Quietly log them in so they can still use matchmaking
        auth.signInAnonymously().catch(error => {
            console.error("Anonymous login failed:", error);
        });
    }
});

class VFXEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        // Request WebGL with alpha enabled so it blends with your HTML background
        this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
        
        if (!this.gl) {
            console.error("WebGL not supported. Falling back to CSS effects.");
            return;
        }

        this.particles = [];
		this.gusts = []; // Tracks physical wind waves moving across the screen
        this.maxParticles = 5000; // easily handles thousands on mobile
        
        // Data structure per particle: [x, y, vx, vy, size, r, g, b, a, life, maxLife]
        this.particleDataLength = 14; 
        this.particleData = new Float32Array(this.maxParticles * this.particleDataLength);
        
        this.initShaders();
        this.initBuffers();
        this.resize();

        // Handle window resizing
        window.addEventListener('resize', () => this.resize());
        
        // Start the render loop
        requestAnimationFrame((time) => this.render(time));
		BootManager.update('Google APIs Loaded.');
    }

    resize() {
		// Get the device pixel ratio (usually 2.0 or 3.0 on mobile)
		// We cap it at 2.0 to maintain high performance on extreme displays
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		
		const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
		const displayHeight = Math.floor(this.canvas.clientHeight * dpr);
		
		if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
			this.canvas.width = displayWidth;
			this.canvas.height = displayHeight;
			this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		}
	}

	initShaders() {
		const vsSource = `
			// Vertex Shader (vsSource)
			attribute vec2 a_position;
			attribute float a_size;
			attribute vec4 a_color;
			attribute float a_angle;
			attribute float a_type; // NEW

			uniform vec2 u_resolution;
			uniform float u_dpr; //Scaling Factor for Mobile

			varying vec4 v_color;
			varying float v_angle;
			varying float v_type; // NEW

			void main() {
				vec2 zeroToOne = a_position / u_resolution;
				vec2 zeroToTwo = zeroToOne * 2.0;
				vec2 clipSpace = zeroToTwo - 1.0;
				
				gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
				gl_PointSize = a_size * 1.5 * u_dpr; 
				v_color = a_color;
				v_angle = a_angle;
				v_type = a_type; // Pass to fragment
			}
			`

const fsSource = `
			precision mediump float;
			varying vec4 v_color;
			varying float v_angle;
			varying float v_type; // Maps to our 6 Seasons (and Dust)

			void main() {
				// Center the coordinates for easier math
				vec2 coord = (gl_PointCoord - vec2(0.5)) * 1.5; 
				float s = sin(v_angle);
				float c = cos(v_angle);
				mat2 rot = mat2(c, -s, s, c);
				coord = rot * coord;
				vec2 st = coord; 

				float alpha = 0.0;
				vec3 finalColor = v_color.rgb;

				// Polar coordinates for complex shapes (Snow, Flowers)
				float r = length(st);
				float a = atan(st.y, st.x);

				if (v_type < 0.5) {
					// 0.0: SAKURA (May / Default)
					vec2 offsetSt = st + vec2(0.5);
					float d1 = distance(offsetSt, vec2(0.0, 0.0));
					float d2 = distance(offsetSt, vec2(1.0, 1.0));
					alpha = smoothstep(1.0, 0.95, d1) * smoothstep(1.0, 0.95, d2);
					finalColor = mix(v_color.rgb, vec3(1.0), 0.4);
				}
				else if (v_type < 1.5) {
					// 1.0: DIRT / CONFETTI (Square)
					vec2 offsetSt = st + vec2(0.5);
					alpha = step(0.1, offsetSt.x) * step(offsetSt.x, 0.9) * step(0.1, offsetSt.y) * step(offsetSt.y, 0.9);
				}
				else if (v_type < 2.5) {
					// 2.0: WINTER SNOWFLAKES (January)
					// Generates a 6-pointed crystal shape
					float f = abs(cos(a * 3.0)) * 0.3 + 0.15;
					alpha = smoothstep(f, f - 0.05, r);
					finalColor = mix(v_color.rgb, vec3(1.0), 0.7); // Extra icy white
				}
				else if (v_type < 3.5) {
					// 3.0: IMPROVED CHERRY BLOSSOM (March)
					
					// 1. Smoother base shape with a soft cleft
					// Using cos(5a) for the lobes, and subtracting a smoothed sin wave for the cleft
					float lobe = cos(a * 5.0);
					float cleft = 0.08 * pow(abs(sin(a * 2.5)), 6.0); 
					float f = 0.35 + 0.1 * lobe - cleft;
					
					// 2. Softer anti-aliasing on the edge (increased from 0.05 to 0.08)
					alpha = smoothstep(f, f - 0.08, r);
					
					// 3. DYNAMIC COLORING (Respects JavaScript v_color)
					// Make the tips a lighter, washed-out version of the base color
					vec3 edgeColor = mix(v_color.rgb, vec3(1.0), 0.5); 
					
					// Make the core a deeper, richer version of the base color
					vec3 coreColor = v_color.rgb * 0.35; 
					
					// 4. Smooth Radial Core (Looks much better at small scales than noisy veins)
					// 1.0 at the center (r=0.0), fading to 0.0 at the edges (r=0.35)
					float coreGradient = smoothstep(0.35, 0.0, r);
					
					finalColor = mix(edgeColor, coreColor, coreGradient);
				}
				else if (v_type < 4.5) {
					// 4.0: SUMMER GRASS (July)
					// Overlap an ellipse with an offset ellipse cutout to make a sweeping crescent blade
					
					// Compress the Y-axis to stretch the math vertically
					vec2 bladeScale = vec2(1.0, 0.3); 
					
					float d1 = distance(st * bladeScale, vec2(-0.05, 0.0)); // The main body
					float d2 = distance(st * bladeScale, vec2(0.15, 0.0));  // The "bite" taken out
					
					// alpha = Inside the main body (*) Outside the cutout
					alpha = smoothstep(0.4, 0.35, d1) * smoothstep(0.35, 0.4, d2);
					
					finalColor = mix(v_color.rgb, vec3(0.5, 1.0, 0.3), 0.2); // Vibrant summer green tint
				}
				else if (v_type < 5.5) {
					// 5.0: DIAMOND (September)
					float d = abs(st.x * 1.6) + abs(st.y);
					
					// Keep the edges sharp with a tight smoothstep
					alpha = smoothstep(0.45, 0.4, d);
				}
				else if (v_type < 6.5) {
					// 6.0: FALL LEAVES - Ginkgo Leaf (Fan shape, brilliant gold)
					vec2 p = st;

					// Polar coordinates (using x,y order so 0 points STRAIGHT UP)
					float a = atan(p.x, p.y);
					float r = length(p);

					// 1. The wavy, clefted top edge of the Ginkgo fan
					float topEdge = 0.35;
					topEdge += 0.02 * sin(a * 15.0);      // Subtle ruffles on the outer edge
					topEdge -= 0.08 * exp(-30.0 * a * a); // The signature split/cleft in the dead center

					// 2. The main fan shape (masking out the radius)
					float fanMask = smoothstep(topEdge + 0.02, topEdge, r);

					// 3. Slice the sides to create the V-shaped fan flare
					// abs(a) goes from 0 (straight up) to PI (straight down).
					float sideSlice = smoothstep(1.1, 0.9, abs(a));
					fanMask *= sideSlice;

					// 4. A delicate little stem pointing downwards from the origin
					float stem = smoothstep(0.015, 0.005, abs(p.x)) * smoothstep(0.0, 0.02, -p.y) * smoothstep(0.4, 0.3, -p.y);

					// Combine the fan and the stem
					alpha = max(fanMask, stem);

					// Brilliant golden-yellow color for autumn Ginkgo
					finalColor = mix(v_color.rgb, vec3(1.0, 0.75, 0.0), 0.7); 
				}
				else if (v_type < 7.5) {
					// 7.0: GOLDEN COIN (Hōshōkin)
					float d = length(st);
					
					// Sharp outer edge
					alpha = smoothstep(0.5, 0.45, d);
					
					// Stamped inner rim effect
					float rim = smoothstep(0.35, 0.4, d) * smoothstep(0.48, 0.4, d);
					
					// Dynamic glint that sweeps as the particle rotates
					float glint = smoothstep(0.1, 0.0, abs(st.x + st.y));
					
					vec3 goldBase = vec3(0.95, 0.75, 0.1);
					vec3 goldDark = vec3(0.7, 0.5, 0.0);
					vec3 goldShine = vec3(1.0, 1.0, 0.8);
					
					finalColor = mix(goldBase, goldDark, rim);
					finalColor = mix(finalColor, goldShine, glint * 0.8);
				}
				
				if (alpha <= 0.0) discard;
				gl_FragColor = vec4(finalColor, v_color.a * alpha);
			}
		`;

		const compileShader = (type, source) => {
			const shader = this.gl.createShader(type);
			this.gl.shaderSource(shader, source);
			this.gl.compileShader(shader);
			if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
				console.error("Shader error:", this.gl.getShaderInfoLog(shader));
				this.gl.deleteShader(shader);
				return null;
			}
			return shader;
		};

		this.program = this.gl.createProgram();
		this.gl.attachShader(this.program, compileShader(this.gl.VERTEX_SHADER, vsSource));
		this.gl.attachShader(this.program, compileShader(this.gl.FRAGMENT_SHADER, fsSource));
		this.gl.linkProgram(this.program);
		this.gl.useProgram(this.program);

		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
		BootManager.update('Painted Sumō-e (相撲絵)...');
	}

	initBuffers() {
		this.buffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.particleData, this.gl.DYNAMIC_DRAW);

		const stride = this.particleDataLength * 4; 
		
		const posLoc = this.gl.getAttribLocation(this.program, "a_position");
		this.gl.enableVertexAttribArray(posLoc);
		this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, stride, 0);

		const sizeLoc = this.gl.getAttribLocation(this.program, "a_size");
		this.gl.enableVertexAttribArray(sizeLoc);
		this.gl.vertexAttribPointer(sizeLoc, 1, this.gl.FLOAT, false, stride, 16);

		const colorLoc = this.gl.getAttribLocation(this.program, "a_color");
		this.gl.enableVertexAttribArray(colorLoc);
		this.gl.vertexAttribPointer(colorLoc, 4, this.gl.FLOAT, false, stride, 20);
		
		// NEW: Pass the rotation angle to the GPU (offset 44 bytes)
		const angleLoc = this.gl.getAttribLocation(this.program, "a_angle");
		this.gl.enableVertexAttribArray(angleLoc);
		this.gl.vertexAttribPointer(angleLoc, 1, this.gl.FLOAT, false, stride, 44);

		const typeLoc = this.gl.getAttribLocation(this.program, "a_type");
		this.gl.enableVertexAttribArray(typeLoc);
		// FIXED: 52 bytes, not 48!
		this.gl.vertexAttribPointer(typeLoc, 1, this.gl.FLOAT, false, stride, 52);		
		
		this.resolutionUniformLocation = this.gl.getUniformLocation(this.program, "u_resolution");
		BootManager.update('Embroidered Keshō-mawashi...');
	}

	emit(x, y, vx, vy, size, r, g, b, a, life, angle = 0, angularVelocity = 0, type = 0.0, zDepth = 1.0) {
		if (this.particles.length >= this.maxParticles) return;
		this.particles.push({
			x, y, vx, vy, size, r, g, b, a, life, maxLife: life, angle, 
			angularVelocity, 
			baseAngularVelocity: angularVelocity, // NEW: Remember the original baseline spin!
			type,
			zDepth
		});
	}
	
	emitHoming(x, y, vx, vy, size, r, g, b, a, life, angle = 0, angularVelocity = 0, type = 0.0, targetX, targetY, delay = 0, zDepth = 1.0) {
        if (this.particles.length >= this.maxParticles) return;
        this.particles.push({
            x, y, vx, vy, size, r, g, b, a, life, maxLife: life, angle, 
            angularVelocity, 
            baseAngularVelocity: angularVelocity,
            type,
            targetX, targetY,
            delay, // <-- NEW: Time to hover before magnet activates
			zDepth
        });
    }
	
	spawnGust(startX, speed, strength, width = 400) {
		this.gusts.push({ x: startX, speed, strength, width });
	}

	render(time) {
        this.resize();
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.uniform2f(this.resolutionUniformLocation, this.canvas.width, this.canvas.height);
        
        const dprLoc = this.gl.getUniformLocation(this.program, "u_dpr");
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.gl.uniform1f(dprLoc, dpr);

        // --- Update physical wind waves ---
        for (let j = this.gusts.length - 1; j >= 0; j--) {
            let g = this.gusts[j];
            g.x += g.speed;
            // Remove the wave once it has safely passed way off screen
            if ((g.speed > 0 && g.x > this.canvas.width + 800) || 
                (g.speed < 0 && g.x < -800)) {
                this.gusts.splice(j, 1);
            }
        }

        let activeCount = 0;
        
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i]; 

            if (p.life === -1) {
                // --- WAVE PHYSICS FOR BACKGROUND PETALS ---
                p.vx *= 0.94; // Air friction
                
                if (p.baseVy === undefined) p.baseVy = p.vy;

                for (let j = 0; j < this.gusts.length; j++) {
                    let g = this.gusts[j];
                    let dist = p.x - g.x;
                    
                    if (Math.abs(dist) < g.width) {
                        let intensity = 1 - (Math.abs(dist) / g.width);
                        let crossSection = Math.abs(Math.sin(p.angle)) + 0.2;
                        
                        // THE FIX: Calculate inertia based on what the size WOULD be at the foreground (z=1)
                        // This prevents tiny background objects from being blasted at warp speed.
                        let trueSize = p.size / (p.zDepth || 1.0);
                        let inertia = (trueSize * trueSize) * 0.02; 
                        
                        let relativeVelocity = g.speed - p.vx;
                        
                        let force = relativeVelocity * intensity * Math.abs(g.strength) * crossSection;
                        
                        // THE FIX: Multiply the final push by zDepth so background particles are affected less
                        let push = (force / inertia) * 0.04 * (p.zDepth || 1.0); 
                        
                        p.vx += push; 
                        
                        let liftFactor = Math.sin(p.angle) * Math.cos(p.angle);
                        let verticalPush = push * liftFactor * 2.0; 
                        p.vy += verticalPush;
                        p.angularVelocity += push * 0.015; 
                    }
                }

                if (p.baseAngularVelocity !== undefined) {
                    p.angularVelocity += (p.baseAngularVelocity - p.angularVelocity) * 0.03;
                }
                
                if (p.baseVy !== undefined) {
                    p.vy += (p.baseVy - p.vy) * 0.05;
                }

                // THE FIX: Apply zDepth to the ambient global wind drift as well
                p.x += p.vx + ((vfx.globalWind || 0) * 0.002 * (p.zDepth || 1.0)); 
                p.y += p.vy;
                p.angle += p.angularVelocity;
                
                if (p.x > this.canvas.width + 100) {
                    p.x = -100;
                } else if (p.x < -100) {
                    p.x = this.canvas.width + 100;
                }
                
                if (p.y > this.canvas.height + 50) {
                    p.y = -50;
                    p.x = Math.random() * this.canvas.width;
                    
                    if (window.game && window.game.getWeightedPetalColor) {
                        const newColor = window.game.getWeightedPetalColor();
                        p.r = newColor.r; p.g = newColor.g; p.b = newColor.b;
                        
                        if (window.game.getCurrentParticleType) p.type = window.game.getCurrentParticleType();
                    }
                }
            } else {
                // --- HOMING OR STANDARD PARTICLE LOGIC ---
                if (p.targetX !== undefined && p.targetY !== undefined) {
                    let age = p.maxLife - p.life;
                    
                    if (age < p.delay) {
                        // 1. THE HANG TIME PHASE
                        // High friction to stop them mid-air, with a tiny bit of gravity
                        p.vx *= 0.88; 
                        p.vy *= 0.88;
                        p.vy += 0.15; 
                        p.life -= 2; 
                    } else {
                        // 2. THE MAGNET PHASE
                        let dx = p.targetX - p.x;
                        let dy = p.targetY - p.y;
                        let dist = Math.sqrt(dx * dx + dy * dy);
                        
                        // The pull gets aggressively stronger the longer the magnet is on
                        let timeActive = age - p.delay;
                        let magnetStrength = 2.0 + (timeActive * 0.05);
                        
                        p.vx += (dx / dist) * magnetStrength;
                        p.vy += (dy / dist) * magnetStrength;
                        
                        p.vx *= 0.86; 
                        p.vy *= 0.86;
                        
                        if (dist < 40) p.size *= 0.85;
                        if (dist < 15) p.life = 0; 
                        
                        p.life -= 2; 
                    }
                } else {
                    p.vx *= 0.92; 
                    p.vy += 0.25; 
                    p.life -= 16;
                }
                
                p.x += p.vx;
                p.y += p.vy;
                p.angle += p.angularVelocity;

                if (p.life <= 0) {
                    this.particles.splice(i, 1);
                    continue; 
                }
            }

            // --- RESTORED CODE: Writing to the WebGL Buffer ---
            const index = activeCount * this.particleDataLength;
            this.particleData[index] = p.x;
            this.particleData[index + 1] = p.y;
            this.particleData[index + 4] = p.size;
            this.particleData[index + 5] = p.r;
            this.particleData[index + 6] = p.g;
            this.particleData[index + 7] = p.b;
            this.particleData[index + 8] = p.a; 
            this.particleData[index + 11] = p.angle;
            this.particleData[index + 13] = p.type;
            
            activeCount++; 
        }

        if (activeCount > 0) {
            this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.particleData);
            this.gl.drawArrays(this.gl.POINTS, 0, activeCount);
        }

        requestAnimationFrame((t) => this.render(t));
    }
}

// Initialize globally so the game object can access it
const vfx = new VFXEngine('vfx-canvas');

const BackgroundManager = {
    canvas: null,
    ctx: null,
    animationFrameId: null,
    isRunning: false,
    currentCity: 'tokyo',
    
    // Time tracking for smooth procedural animations
    lastTime: 0,
    elapsed: 0,
	
	// Tracks the procedural particles and math for each scene
    bgState: {
        initialized: false,
        city: '',
        fog: [],
        buildings: [], // Replaces orbs
        rays: [],
        clouds: [],
        mist: []
    },

    init: function(containerId) {
        const container = document.getElementById(containerId) || document.body;
        
        // Create and inject the canvas
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'atmospheric-bg-canvas';
        container.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        
        // Initial sizing
        this.resize();
        
        // Listen for window resizing to keep the canvas crisp
        window.addEventListener('resize', () => this.resize());
		BootManager.update('Purified Environments...');
    },

    resize: function() {
        if (!this.canvas) return;
        // Match internal canvas resolution to the display size
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },

    setBashoScene: function(bashoIndex) {
        // Map the 0-5 basho index to the corresponding city
        const cityMap = {
            0: 'tokyo',   // Hatsu
            1: 'osaka',   // Haru
            2: 'tokyo',   // Natsu
            3: 'nagoya',  // Nagoya
            4: 'tokyo',   // Aki
            5: 'fukuoka'  // Kyushu
        };
        
        this.setCity(cityMap[bashoIndex] || 'tokyo');
        
        // Optional: Reset animation timers when changing scenes
        this.elapsed = 0; 
    },
	
	setCity: function(newCity) {
		// 1. Update the state string
		this.currentCity = newCity;
		
		// 2. THE FIX: Rewind the intro timer back to 0! 
		// This forces the getPopScale math to actually trigger.
		if (this.bgState) {
			this.bgState.introTimer = 0;
			
			// 3. Clear the old arrays. 
			// If you don't do this, Tokyo might try to pop using Osaka's leftover arrays!
			this.bgState.buildings = [];
			this.bgState.traffic = [];
			this.bgState.fog = [];
			this.bgState.mist = [];
			this.bgState.clouds = [];
            this.bgState.dynamicCityLights = [];
			// Roll for the Easter Egg (1 in 20 chance)
			this.bgState.showEasterEgg = Math.random() < 0.1;
			console.log(this.bgState.showEasterEgg);
		}

		// 4. (Optional) If you still rely on initSceneState for base logic, call it here:
		if (this.initSceneState && this.canvas) {
			this.initSceneState(this.canvas.width, this.canvas.height);
		}
	},

    start: function() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.renderLoop();
    },

    stop: function() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    },
	
	show: function() {
        if (this.canvas) {
            this.canvas.style.display = 'block'; // Reveal it
            this.canvas.style.opacity = '1';
        }
        this.start(); // Boot up the render loop
    },

    hide: function() {
        if (this.canvas) {
            this.canvas.style.display = 'none'; // Hide it entirely
            this.canvas.style.opacity = '0';
        }
        this.stop(); // Kill the render loop to save CPU!
    },

    renderLoop: function(currentTime) {
        if (!this.isRunning) return;

        // Calculate delta time for smooth animations regardless of framerate
        const deltaTime = (currentTime - this.lastTime) || 0;
        this.lastTime = currentTime;
        this.elapsed += deltaTime;

        // Clear the canvas for the new frame
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		
		// Initialize or reset particle states if the scene changed
        if (this.bgState.city !== this.currentCity) {
            this.initSceneState(this.canvas.width, this.canvas.height);
            this.bgState.city = this.currentCity;
        }

        // Route to the correct drawing function based on the current city
        switch(this.currentCity) {
            case 'tokyo':
                this.drawTokyo(deltaTime);
                break;
            case 'osaka':
                this.drawOsaka(deltaTime);
                break;
            case 'nagoya':
                this.drawNagoya(deltaTime);
                break;
            case 'fukuoka':
                this.drawFukuoka(deltaTime);
                break;
        }

        // Request the next frame
        this.animationFrameId = requestAnimationFrame((time) => this.renderLoop(time));
    },
	
	initSceneState: function(w, h) {
        this.bgState.fog = [];
        this.bgState.buildings = [];
        this.bgState.rays = [];
        this.bgState.clouds = [];
        this.bgState.mist = [];

        // 1. TOKYO: Grand 3D Cityscape
        const numBuildings = 25; // Dense city skyline
        for (let i = 0; i < numBuildings; i++) {
            const bw = 40 + Math.random() * 60; // Building width
            const bh = 150 + Math.random() * (h * 0.6); // Heights up to 60% of screen
            const bx = (Math.random() * (w + 200)) - 100; // Spread across screen
            const bDepth = 15 + Math.random() * 20; // 3D extrusion depth
            
            const windows = [];
            const cols = Math.floor(bw / 16);
            const rows = Math.floor(bh / 20);
            
            // Generate the grid of light spheres
            for (let c = 1; c <= cols; c++) {
                for (let r = 1; r <= rows; r++) {
                    if (Math.random() > 0.3) { // 70% chance a window slot has a fixture
                        windows.push({
                            x: (c * (bw / (cols + 1))),
                            y: bh - (r * 20) + 5,
                            op: Math.random() > 0.6 ? 0.8 : 0, // Starting opacity
                            targetOp: Math.random() > 0.6 ? 0.8 : 0, // Target opacity
                            speed: 0.3 + Math.random() * 1.0 // Fade speed per second
                        });
                    }
                }
            }
            
            this.bgState.buildings.push({
                x: bx, w: bw, h: bh, depth: bDepth, windows: windows
            });
        }
        
        // Sort by height descending so tallest buildings render in the back
        this.bgState.buildings.sort((a, b) => b.h - a.h);
        
        // Tokyo Fog (Amorphous blobs weaving through the city)
        const totalFogBlobs = 15;
        for(let i=0; i<totalFogBlobs; i++) {
            this.bgState.fog.push({
                x: Math.random() * w, 
                y: h * 0.5 + Math.random() * h * 0.4,
                rx: 150 + Math.random() * 200, 
                ry: 50 + Math.random() * 70, 
                vx: 10 + Math.random() * 15, 
                // NEW: Increased base opacity and variance for thicker fog
                op: 0.04 + Math.random() * 0.05 
            });
        }

        // Osaka God Rays (Widened and Cleaned Up)
        const totalRays = 12;
        for(let i=0; i<totalRays; i++) {
            // Evenly spacing angles rather than random distribution
            const angleOffset = (i / totalRays) * Math.PI * 1.5 - (Math.PI * 0.75);
            this.bgState.rays.push({ 
                angleOffset: angleOffset, 
                width: 0.1 + Math.random() * 0.15, // more consistent width
                op: 0.03 + Math.random() * 0.06, 
                speed: 0.0001 + Math.random() * 0.0003 // even slower
            });
        }
		
		// --- NEW: Osaka Swaying Ornaments ---
        this.bgState.ornaments = [];
        const totalOrnaments = 8; // 4 roof tiers * 2 corners
        for(let i=0; i<totalOrnaments; i++) {
            this.bgState.ornaments.push({
                phase: Math.random() * Math.PI * 2, // Random starting swing
                speed: 0.0015 + Math.random() * 0.001, // Gentle sway speed
                angleAmp: 0.05 + Math.random() * 0.08, // Max swing angle (gentle breeze)
                length: 10 + Math.random() * 8 // Variation in chain length
            });
        }

        // Fukuoka Clouds & Mist
        for(let i=0; i<8; i++) {
            this.bgState.clouds.push({ x: Math.random() * w, y: Math.random() * h * 0.4, w: 150 + Math.random() * 300, h: 20 + Math.random() * 40, vx: 5 + Math.random() * 15, op: 0.1 + Math.random() * 0.2 });
        }
        for(let i=0; i<25; i++) {
            this.bgState.mist.push({ x: Math.random() * w, y: h - (Math.random() * h * 0.3), r: 40 + Math.random() * 100, vx: -5 - Math.random() * 10, op: 0.02 + Math.random() * 0.05 });
        }
    },
	
	drawTokyo: function(dt) {
		const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height;
		
		if (this.isCinematicActive) {
			ctx.fillStyle = '#05070d';
			ctx.fillRect(0, 0, w, h);
			return;
		}
		
		const safeDt = Math.min(dt, 32);
		this.bgState.introTimer = (this.bgState.introTimer || 0) + safeDt;
		const t = this.bgState.introTimer;
		
		const groundY = h * 1.05; 

		// --- 1. OPTIMIZED SKY & LIGHT POLLUTION PASS ---
		if (!this.bgState.tokyoSkyCache || this.bgState.tokyoSkyCache.width !== w || this.bgState.tokyoSkyCache.height !== h) {
			this.bgState.tokyoSkyCache = document.createElement('canvas');
			this.bgState.tokyoSkyCache.width = w; this.bgState.tokyoSkyCache.height = h;
			const skyCtx = this.bgState.tokyoSkyCache.getContext('2d');

			let grad = skyCtx.createLinearGradient(0, 0, 0, h);
			grad.addColorStop(0, '#0a0d1c'); grad.addColorStop(0.6, '#1a2245'); grad.addColorStop(1, '#1d4659');   
			skyCtx.fillStyle = grad; skyCtx.fillRect(0, 0, w, h);

			skyCtx.fillStyle = '#ffffff';
			const moonX = w * 0.8; const moonY = h * 0.1;
			skyCtx.beginPath(); skyCtx.arc(moonX, moonY, h * 0.02, 0, Math.PI * 2); skyCtx.fill();
			skyCtx.globalAlpha = 0.3;
			for (let i = 0; i < 200; i++) {
				skyCtx.beginPath(); skyCtx.arc(Math.random() * w, Math.random() * (h * 0.8), Math.random() * 1.5, 0, Math.PI * 2); skyCtx.fill();
			}
			skyCtx.globalAlpha = 1.0;
		}

		const tokyoPhrases = ["残", "横", "大", "満", "寄", "土", "力", "勝"];

		// --- HELPER: Extracts the heavy 3D Path math out of the main loop ---
		const drawBuildingChassis = (context, b, currentGroundY, canvasH) => {
			const frontColor = `hsl(${b.chassisHue}, 40%, 12%)`; 
			const sideColor = `hsl(${b.chassisHue}, 50%, 5%)`;  
			const topColor = `hsl(${b.chassisHue}, 40%, 18%)`;   

			// 3D EXTRACTION (SIDE FACE)
			context.fillStyle = sideColor; context.beginPath();
			context.moveTo(b.x + b.w, currentGroundY); context.lineTo(b.x + b.w, currentGroundY - b.h);
			context.lineTo(b.x + b.w + b.depth, currentGroundY - b.h - (b.depth * 0.6)); context.lineTo(b.x + b.w + b.depth, currentGroundY - (b.depth * 0.6)); context.fill();

			if (b.signs && b.signs.length > 0) {
				context.save(); context.globalCompositeOperation = 'screen'; context.textAlign = 'center'; context.textBaseline = 'middle';
				const fontLarge = `bold ${canvasH * 0.015}px serif`;
				const fontSmall = `bold ${canvasH * 0.01}px serif`;

				context.font = fontLarge;
				b.signs.forEach(sign => {
					const sx = b.x + b.w + b.depth * 0.5; const sy = currentGroundY - (b.depth * 0.3) - (b.h - b.depth * 0.3) * sign.yPct;
					context.fillStyle = `hsl(${sign.hue}, 100%, 60%)`; 
					context.fillText(sign.char, sx, sy);
				});

				context.font = fontSmall;
				context.fillStyle = `rgba(255, 255, 255, 0.9)`; 
				b.signs.forEach(sign => {
					const sx = b.x + b.w + b.depth * 0.5; const sy = currentGroundY - (b.depth * 0.3) - (b.h - b.depth * 0.3) * sign.yPct;
					context.fillText(sign.char, sx, sy);
				});
				context.restore();
			}

			// 3D TOP FACE 
			context.fillStyle = topColor; context.beginPath();
			const topY = currentGroundY - b.h; const rearY = topY - (b.depth * 0.6);
			context.moveTo(b.x, topY); context.lineTo(b.x + b.depth, rearY); context.lineTo(b.x + b.w + b.depth, rearY); context.lineTo(b.x + b.w, topY); context.fill();

			// --- PROCEDURAL 3D ROOF DETAILS ---
			const drawProp = (localX, localZ, pw, ph, pDepth, hueSatLight) => {
				const px = b.x + localX + localZ; 
				const py = topY - (localZ * 0.6); 
				
				context.fillStyle = `hsl(${hueSatLight[0]}, ${hueSatLight[1]}%, ${Math.max(0, hueSatLight[2] - 10)}%)`; 
				context.beginPath();
				context.moveTo(px + pw, py); context.lineTo(px + pw, py - ph);
				context.lineTo(px + pw + pDepth, py - ph - (pDepth * 0.6)); context.lineTo(px + pw + pDepth, py - (pDepth * 0.6)); context.fill();
				
				context.fillStyle = `hsl(${hueSatLight[0]}, ${hueSatLight[1]}%, ${Math.min(100, hueSatLight[2] + 10)}%)`; 
				context.beginPath();
				context.moveTo(px, py - ph); context.lineTo(px + pDepth, py - ph - (pDepth * 0.6));
				context.lineTo(px + pw + pDepth, py - ph - (pDepth * 0.6)); context.lineTo(px + pw, py - ph); context.fill();
				
				context.fillStyle = `hsl(${hueSatLight[0]}, ${hueSatLight[1]}%, ${hueSatLight[2]}%)`; 
				context.fillRect(px, py - ph, pw, ph);
			};

			context.strokeStyle = `rgba(255,255,255,0.05)`; context.lineWidth = 1;
			context.beginPath(); context.moveTo(b.x, topY); context.lineTo(b.x + b.w, topY); context.lineTo(b.x + b.w + b.depth, rearY); context.stroke();

			// THE FIX 1: Read from the pre-generated caches instead of rolling Math.random() here!
			if (b.roofProps) {
				b.roofProps.forEach(prop => {
					drawProp(b.w * prop.lx, b.depth * prop.lz, b.w * prop.pw, canvasH * prop.ph, b.depth * prop.pd, prop.hue);
				});
			}

			if (b.spikes) {
				b.spikes.forEach(spike => {
					const localZ = b.depth * spike.lz;
					const sx = b.x + (b.w * spike.ox) + localZ; 
					const sy = topY - (localZ * 0.6); 
					const spikeH = (b.w * spike.sh) + canvasH * 0.03;
					
					context.strokeStyle = `hsl(${b.chassisHue}, 10%, 30%)`; context.lineWidth = 1.5; 
					context.beginPath(); context.moveTo(sx, sy); context.lineTo(sx, sy - spikeH); context.stroke();
					
					if (spikeH > canvasH * 0.04) {
						context.lineWidth = 0.5;
						context.beginPath(); context.moveTo(sx - 3, sy - spikeH*0.4); context.lineTo(sx + 3, sy - spikeH*0.4); context.stroke();
						context.beginPath(); context.moveTo(sx - 2, sy - spikeH*0.7); context.lineTo(sx + 2, sy - spikeH*0.7); context.stroke();
					}

					context.fillStyle = 'rgba(255, 50, 50, 0.9)';
					context.beginPath(); context.arc(sx, sy - spikeH, 1.5, 0, Math.PI*2); context.fill();
				});
			}

			// FRONT FACE (Because chassisHue is guaranteed to exist now, this will never paint red by accident)
			context.fillStyle = frontColor; context.fillRect(b.x, currentGroundY - b.h, b.w, b.h);
		};

		// --- 2. GENERATION PHASE ---
		if (!this.bgState.buildings || this.bgState.buildings.length === 0 || this.bgState.buildings[0].popDelay === undefined) {
			this.bgState.buildings = [];
			
			const numBlocks = 55; 
			const startX = -w * 0.15;
			const spanWidth = w * 1.3;
			const segmentSize = spanWidth / numBlocks;
			
			if (!this.bgState.windowSprite || this.bgState.windowSpriteSize !== h) {
				this.bgState.windowSpriteSize = h;
				const wCnv = document.createElement('canvas');
				const r1 = h * 0.003; const r2 = h * 0.0012;
				const size = Math.ceil(r1 * 2) + 2; 
				wCnv.width = size; wCnv.height = size;
				const wCtx = wCnv.getContext('2d');
				const cx = size / 2;
				
				wCtx.beginPath(); wCtx.arc(cx, cx, r1, 0, Math.PI * 2);
				wCtx.fillStyle = 'rgba(255, 210, 130, 1.0)'; wCtx.fill(); 
				wCtx.beginPath(); wCtx.arc(cx, cx, r2, 0, Math.PI * 2);
				wCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'; wCtx.fill(); 
				
				this.bgState.windowSprite = wCnv;
				this.bgState.winOffset = cx;
			}
			
			for (let i = 0; i < numBlocks; i++) {
				const bx = startX + (i * segmentSize) + (Math.random() * segmentSize * 1.5);
				const bWidth = w * 0.03 + Math.random() * w * 0.05;
				
				const bHeight = h * 0.35 + Math.random() * h * 0.6;
				const bDepth = w * 0.02 + Math.random() * w * 0.02;
				const archType = Math.floor(Math.random() * 4);

				const building = {
					x: bx, w: bWidth, h: bHeight, depth: bDepth,
					type: archType, chassisHue: 210 + Math.random() * 30, 
					windows: [], signs: []
				};

				const rows = 12 + Math.floor(Math.random() * 10);
				const cols = 5 + Math.floor(Math.random() * 4);
				for (let r = 0; r < rows; r++) {
					for (let c = 0; c < cols; c++) {
						const targetOp = Math.random() > 0.6 ? 0.8 : 0;
						building.windows.push({
							x: (building.w / (cols + 1)) * (c + 1), y: (building.h / (rows + 1)) * (r + 1),
							op: Math.random() > 0.3 ? targetOp : 0, targetOp: targetOp, speed: 0.1 + Math.random() * 0.4
						});
					}
				}
				
				const signHues = [180, 320, 50, 0]; 
				if (bHeight > h * 0.35) {
					const signRows = 5 + Math.floor(Math.random() * 8);
					for (let r = 0; r < signRows; r++) {
						building.signs.push({ char: tokyoPhrases[Math.floor(Math.random() * tokyoPhrases.length)], hue: signHues[Math.floor(Math.random() * signHues.length)], yPct: (r + 1) / (signRows + 1) });
					}
				}
				this.bgState.buildings.push(building);
			}

			// THE FIX 2: Added chassisHue: 5 (deep red base) so the frontend color parser doesn't break
			this.bgState.buildings.push({ x: w * 0.6, w: w * 0.03, h: h * 0.95, depth: w * 0.02, type: 5, chassisHue: 5, windows: [], signs: [] });
			
			// --- THE FIX 3: GENERATE ROOF CACHE ONCE ---
			this.bgState.buildings.forEach(b => {
				b.roofProps = [];
				b.spikes = [];
				
				if (b.type === 0 || b.type === 1) { 
					const numAC = 1 + Math.floor(Math.random() * 3);
					for(let i=0; i<numAC; i++) b.roofProps.push({ lx: 0.1 + Math.random() * 0.6, lz: 0.1 + Math.random() * 0.6, pw: 0.15, ph: 0.006, pd: 0.2, hue: [b.chassisHue, 5, 25] });
				} else if (b.type === 2) { 
					b.roofProps.push({ lx: 0.25, lz: 0.25, pw: 0.5, ph: 0.015, pd: 0.5, hue: [b.chassisHue, 20, 20] });
					b.roofProps.push({ lx: 0.6, lz: 0.1, pw: 0.2, ph: 0.008, pd: 0.2, hue: [b.chassisHue, 10, 30] });
				} else if (b.type === 3) { 
					b.roofProps.push({ lx: 0.2, lz: 0.3, pw: 0.4, ph: 0.03, pd: 0.4, hue: [b.chassisHue, 35, 15] });
					b.roofProps.push({ lx: 0.6, lz: 0.5, pw: 0.2, ph: 0.015, pd: 0.3, hue: [b.chassisHue, 15, 25] });
				} else if (b.type === 4 || b.type === 5) { 
					const numSpikes = b.type === 5 ? 6 : 2;
					for(let i=0; i<numSpikes; i++) b.spikes.push({ lz: Math.random() * 0.8, ox: 0.2 + Math.random() * 0.6, sh: Math.random() * 0.3 });
					b.roofProps.push({ lx: 0.3, lz: 0.2, pw: 0.4, ph: 0.01, pd: 0.6, hue: [b.chassisHue, 10, 20] });
				}
			});

			this.bgState.buildings.sort((a, b) => a.x - b.x); 
			this.bgState.buildings.forEach((b, index) => { b.popDelay = index * 35; });

			for (let i = 0; i < this.bgState.buildings.length; i++) {
				const b = this.bgState.buildings[i];
				b.windows = b.windows.filter(win => {
					const wx = b.x + win.x;
					const wy = groundY - b.h + win.y;
					for (let j = i + 1; j < this.bgState.buildings.length; j++) {
						const frontB = this.bgState.buildings[j];
						const frontTopY = groundY - frontB.h;
						if (wx >= frontB.x && wx <= frontB.x + frontB.w && wy >= frontTopY) return false; 
						if (wx > frontB.x + frontB.w && wx <= frontB.x + frontB.w + frontB.depth) {
							const depthOffset = wx - (frontB.x + frontB.w);
							const sideTopY = frontTopY - (depthOffset * 0.6);
							const sideBottomY = groundY - (depthOffset * 0.6);
							if (wy >= sideTopY && wy <= sideBottomY) return false; 
						}
					}
					return true; 
				});
			}

			this.bgState.cityChassisCache = document.createElement('canvas');
			this.bgState.cityChassisCache.width = w;
			this.bgState.cityChassisCache.height = h;
			const cCtx = this.bgState.cityChassisCache.getContext('2d');
			
			this.bgState.buildings.forEach(b => {
				drawBuildingChassis(cCtx, b, groundY, h);
			});
		}

		// --- 3. RENDERING PHASE ---
		ctx.globalAlpha = Math.min(1, t / 400);
		ctx.drawImage(this.bgState.tokyoSkyCache, 0, 0);
		ctx.globalAlpha = 1.0;

		const isIntroDone = t > 2000;

		if (isIntroDone && this.bgState.cityChassisCache) {
			ctx.drawImage(this.bgState.cityChassisCache, 0, 0);
			
			this.bgState.buildings.forEach(b => {
				ctx.save(); ctx.globalCompositeOperation = 'screen';
				const winSprite = this.bgState.windowSprite;
				const winOffset = this.bgState.winOffset;
				
				b.windows.forEach(win => {
					if (Math.random() < 0.001) { win.targetOp = win.targetOp > 0.4 ? 0 : 0.8; }
					if (win.op < win.targetOp) win.op = Math.min(win.targetOp, win.op + (win.speed * dt / 1000));
					if (win.op > win.targetOp) win.op = Math.max(win.targetOp, win.op - (win.speed * dt / 1000));
					
					if (win.op > 0.01) {
						ctx.globalAlpha = win.op;
						ctx.drawImage(winSprite, b.x + win.x - winOffset, groundY - b.h + win.y - winOffset);
					}
				});
				ctx.restore();
			});
		} else {
			this.bgState.buildings.forEach(b => {
				const scale = this.getPopScale(t, b.popDelay, 500);
				if (scale === 0) return; 
				
				ctx.save();
				ctx.translate(b.x + b.w/2, groundY);
				ctx.scale(Math.min(1, scale), scale); 
				ctx.translate(-(b.x + b.w/2), -groundY);

				drawBuildingChassis(ctx, b, groundY, h);

				ctx.save(); ctx.globalCompositeOperation = 'screen';
				const winSprite = this.bgState.windowSprite;
				const winOffset = this.bgState.winOffset;
				
				b.windows.forEach(win => {
					if (Math.random() < 0.001) { win.targetOp = win.targetOp > 0.4 ? 0 : 0.8; }
					if (win.op < win.targetOp) win.op = Math.min(win.targetOp, win.op + (win.speed * dt / 1000));
					if (win.op > win.targetOp) win.op = Math.max(win.targetOp, win.op - (win.speed * dt / 1000));
					
					if (win.op > 0.01) {
						ctx.globalAlpha = win.op;
						ctx.drawImage(winSprite, b.x + win.x - winOffset, groundY - b.h + win.y - winOffset);
					}
				});
				ctx.restore(); 
				ctx.restore();
			});
		}

		// --- 4. VOLUMETRIC FOG ---
		if (this.bgState.fog) {
			ctx.globalAlpha = Math.max(0, Math.min(1, (t - 1500) / 800));
			ctx.fillStyle = 'rgba(180, 190, 240, 1)';
			this.bgState.fog.forEach(f => {
				f.x += f.vx * (dt / 1000); if (f.x - f.rx > w) f.x = -f.rx;
				const currentOp = f.op * ctx.globalAlpha;
				ctx.save(); ctx.globalAlpha = currentOp; ctx.beginPath(); 
				ctx.ellipse(f.x, f.y, f.rx, f.ry, 0, 0, Math.PI * 2); ctx.ellipse(f.x + f.ry*0.5, f.y + f.ry*0.2, f.rx*0.8, f.ry*1.2, Math.PI * 0.2, 0, Math.PI * 2);
				ctx.fill(); ctx.restore();
			});
			ctx.globalAlpha = 1.0;
		}

		// --- 5. FOREGROUND ARENA SILHOUETTE ---
		ctx.fillStyle = '#05070d'; ctx.beginPath(); ctx.moveTo(w * 0.1, h); ctx.quadraticCurveTo(w * 0.5, h * 0.6, w * 0.9, h); ctx.fill();
	},

	drawOsaka: function(dt) {
		const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height;
		const cx = w * 0.78; 
		const baseY = h - h*0.22;
		
		this.bgState.introTimer = (this.bgState.introTimer || 0) + dt;
		const t = this.bgState.introTimer;
		
		// --- 1. INITIALIZATION: CACHING & SPRITE BAKING ---
		if (!this.bgState.osakaCache || this.bgState.osakaCache.width !== w || this.bgState.osakaCache.height !== h) {
			this.bgState.osakaCache = { width: w, height: h };			
			
			this.bgState.skyCache = document.createElement('canvas');
			this.bgState.skyCache.width = w; this.bgState.skyCache.height = h;
			const skyCtx = this.bgState.skyCache.getContext('2d');
			
			let skyGrad = skyCtx.createLinearGradient(0, 0, 0, h);
			skyGrad.addColorStop(0, '#75a89a'); skyGrad.addColorStop(0.5, '#f0a8a1'); skyGrad.addColorStop(1, '#fad1b1');
			skyCtx.fillStyle = skyGrad; skyCtx.fillRect(0, 0, w, h);

			let cloudGrad = skyCtx.createRadialGradient(cx, h*0.6, 0, cx, h*0.6, w*0.4);
			cloudGrad.addColorStop(0, 'rgba(255, 140, 120, 0.9)');
			cloudGrad.addColorStop(0.4, 'rgba(255, 180, 140, 0.6)');
			cloudGrad.addColorStop(1, 'rgba(255, 180, 140, 0)');
			skyCtx.fillStyle = cloudGrad;
			skyCtx.beginPath(); skyCtx.arc(cx, h*0.6, w*0.4, 0, Math.PI*2); skyCtx.fill();

			this.bgState.rayGrad = ctx.createLinearGradient(0, 0, 0, h * 3); 
			this.bgState.rayGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
			this.bgState.rayGrad.addColorStop(0.8, 'rgba(255, 255, 255, 0)');

			const pSize = 20; 
			this.bgState.petalSprite = document.createElement('canvas');
			this.bgState.petalSprite.width = pSize; this.bgState.petalSprite.height = pSize;
			const pCtx = this.bgState.petalSprite.getContext('2d');
			pCtx.fillStyle = '#ffb7c5';
			pCtx.translate(pSize/2, pSize/2);
			pCtx.beginPath();
			pCtx.moveTo(0, -pSize/2); pCtx.quadraticCurveTo(pSize/2, 0, 0, pSize/2); pCtx.quadraticCurveTo(-pSize/2, 0, 0, -pSize/2);
			pCtx.fill();

			const oW = Math.ceil(w*0.02); const oH = Math.ceil(h*0.04);
			this.bgState.ornamentSprite = document.createElement('canvas');
			this.bgState.ornamentSprite.width = oW; this.bgState.ornamentSprite.height = oH;
			const oCtx = this.bgState.ornamentSprite.getContext('2d');
			oCtx.translate(oW/2, 0);
			let goldGradLive = oCtx.createLinearGradient(-w*0.003, 0, w*0.003, 0); 
			goldGradLive.addColorStop(0, '#d4af37'); goldGradLive.addColorStop(0.5, '#fff4cc'); goldGradLive.addColorStop(1, '#b87333');
			oCtx.fillStyle = goldGradLive; oCtx.beginPath();
			oCtx.moveTo(0, 0); oCtx.lineTo(w*0.003, h*0.008); oCtx.lineTo(0, h*0.015); oCtx.lineTo(-w*0.003, h*0.008); oCtx.fill();
			oCtx.strokeStyle = '#c0392b'; oCtx.beginPath(); oCtx.moveTo(0, h*0.015); oCtx.lineTo(0, h*0.025); oCtx.stroke();

			this.bgState.midgroundCache = document.createElement('canvas');
			this.bgState.midgroundCache.width = w; this.bgState.midgroundCache.height = h;
			const mgCtx = this.bgState.midgroundCache.getContext('2d'); 

			this.bgState.sakuraBranches = [];
			this.bgState.fallingPetals = [];
			this.bgState.clusterSprites = {}; 
			this.bgState.bird = { active: false, nextSpawn: this.elapsed + 20000 + Math.random() * 25000 };

			let goldGrad = mgCtx.createLinearGradient(cx - w*0.15, 0, cx + w*0.15, 0);
			goldGrad.addColorStop(0, '#b87333'); goldGrad.addColorStop(0.3, '#ffd700'); 
			goldGrad.addColorStop(0.5, '#fff4cc'); goldGrad.addColorStop(0.8, '#d4af37'); goldGrad.addColorStop(1, '#8b6508');   

			let wallGrad = mgCtx.createLinearGradient(cx - w*0.2, 0, cx + w*0.2, 0);
			wallGrad.addColorStop(0, '#fffcf7'); wallGrad.addColorStop(0.7, '#e6dfd3'); wallGrad.addColorStop(1, '#c2b8a7'); 

			let blackWallGrad = mgCtx.createLinearGradient(cx - w*0.1, 0, cx + w*0.1, 0);
			blackWallGrad.addColorStop(0, '#333333'); blackWallGrad.addColorStop(0.5, '#1f1f1f'); blackWallGrad.addColorStop(1, '#0a0a0a');

			let roofGrad = mgCtx.createLinearGradient(cx, 0, cx, h);
			roofGrad.addColorStop(0, '#3e7a68'); roofGrad.addColorStop(1, '#1b3d33'); 

			const buildTree = (x, y, scale, paletteIdx, isBg) => {
				mgCtx.strokeStyle = isBg ? '#2a1a10' : '#3d2817'; 
				mgCtx.lineWidth = scale * 0.15; mgCtx.lineCap = 'round'; mgCtx.lineJoin = 'round';
				mgCtx.beginPath();
				mgCtx.moveTo(x, y + scale * 2.5); mgCtx.lineTo(x + scale * 0.1, y + scale * 0.5);
				mgCtx.moveTo(x + scale * 0.08, y + scale * 1.1); mgCtx.quadraticCurveTo(x - scale * 0.4, y + scale * 0.8, x - scale * 0.8, y + scale * 0.2);
				mgCtx.moveTo(x + scale * 0.09, y + scale * 1.4); mgCtx.quadraticCurveTo(x + scale * 0.5, y + scale * 1.0, x + scale * 0.9, y + scale * 0.4);
				mgCtx.moveTo(x + scale * 0.1, y + scale * 0.5); mgCtx.lineTo(x - scale * 0.1, y - scale * 0.1);
				mgCtx.stroke();

				const branchLayouts = isBg ? [ {cx: x, cy: y, r: scale * 1.1} ] : [ {cx: x - scale * 0.8, cy: y + scale * 0.2, r: scale * 0.8}, {cx: x + scale * 0.9, cy: y + scale * 0.4, r: scale * 0.85}, {cx: x - scale * 0.1, cy: y - scale * 0.1, r: scale * 0.9}, {cx: x + scale * 0.3, cy: y + scale * 0.5, r: scale * 1.0}, {cx: x, cy: y + scale * 0.2, r: scale * 1.2} ];
				const sakuraPalettes = [ { base: '#ffb7c5', shadow: '#d67c93' }, { base: '#ff9eb5', shadow: '#c45c7a' }, { base: '#ffcce6', shadow: '#d98cb3' }, { base: '#f78fa7', shadow: '#b54b68' } ];

				const spriteGroup = this.bgState.clusterSprites[`${isBg ? 'bg' : 'fg'}_${paletteIdx}`];
				branchLayouts.forEach(branch => {
					this.bgState.sakuraBranches.push({
						cx: branch.cx, cy: branch.cy, baseR: branch.r, macroPhase: x * 0.01 + y * 0.01, 
						microPhase: Math.random() * Math.PI * 2, sprite: spriteGroup[Math.floor(Math.random() * spriteGroup.length)] 
					});
				});
			};

			const generateClusterSprite = (baseColor, shadowColor, isBg) => {
				const size = 600; const r = 240;    
				const c = document.createElement('canvas'); c.width = size; c.height = size;
				const cCtx = c.getContext('2d');
				const leafCount = isBg ? 30 : 65; 
				for (let i = 0; i < leafCount; i++) {
					const angle = Math.random() * Math.PI * 2; const dist = r * Math.pow(Math.random(), 0.5); 
					const px = size/2 + Math.cos(angle) * dist; const py = size/2 + Math.sin(angle) * dist * 0.75; 
					const pr = 40 + Math.random() * 30; 
					let color = baseColor; const rand = Math.random();
					if (dist > r * 0.65) color = isBg ? '#8a3352' : shadowColor;
					else if (rand > 0.75 && !isBg) color = '#fff9fb';
					else if (rand > 0.45 && !isBg) color = '#ffcce0';
					cCtx.fillStyle = color; cCtx.beginPath();
					cCtx.ellipse(px, py, pr * 1.3, pr * 0.7, Math.random() * Math.PI * 2, 0, Math.PI * 2); cCtx.fill();
				}
				return c;
			};

			const sakuraPalettes = [ { base: '#ffb7c5', shadow: '#d67c93' }, { base: '#ff9eb5', shadow: '#c45c7a' }, { base: '#ffcce6', shadow: '#d98cb3' }, { base: '#f78fa7', shadow: '#b54b68' } ];
			sakuraPalettes.forEach((pal, idx) => {
				this.bgState.clusterSprites[`fg_${idx}`] = [generateClusterSprite(pal.base, pal.shadow, false), generateClusterSprite(pal.base, pal.shadow, false), generateClusterSprite(pal.base, pal.shadow, false)];
				this.bgState.clusterSprites[`bg_${idx}`] = [generateClusterSprite(pal.base, pal.shadow, true)];
			});

			for (let tx = w * 0.85; tx > -w * 0.1; tx -= w * 0.055) {
				const ty = baseY + (Math.sin(tx * 0.015) * h * 0.05) + h * 0.12; 
				const paletteIdx = Math.floor(Math.abs(Math.sin(tx * 0.1) * sakuraPalettes.length));
				const bgPaletteIdx = (paletteIdx + 1) % sakuraPalettes.length;
				const scale = w * (0.07 + Math.abs(Math.cos(tx * 0.02)) * 0.03); 
				buildTree(tx + w * 0.02, ty - h * 0.03, scale * 0.8, bgPaletteIdx, true); 
				buildTree(tx, ty, scale, paletteIdx, false); 
			}

			mgCtx.save(); mgCtx.beginPath(); 
			mgCtx.moveTo(cx - w*0.3, h); mgCtx.lineTo(cx - w*0.18, baseY);
			mgCtx.lineTo(cx + w*0.18, baseY); mgCtx.lineTo(cx + w*0.3, h); mgCtx.clip();
			mgCtx.fillStyle = '#3a342c'; mgCtx.fillRect(0, baseY, w, h); 
			
			const stoneH = 16; const stoneW = 45;
			for(let sy = baseY; sy < h; sy += stoneH) {
				let offset = ((sy - baseY) % (stoneH * 2) < stoneH) ? 0 : -(stoneW / 2);
				for(let sx = cx - w*0.35; sx < cx + w*0.35; sx += stoneW) {
					let stGrad = mgCtx.createLinearGradient(sx, sy, sx + stoneW, sy + stoneH);
					stGrad.addColorStop(0, Math.random() > 0.5 ? '#7a7062' : '#696054'); stGrad.addColorStop(1, '#3b352e');
					mgCtx.fillStyle = stGrad; mgCtx.fillRect(sx + offset, sy, stoneW - 1, stoneH - 1); 
					mgCtx.strokeStyle = '#1a1612'; mgCtx.lineWidth = 1; mgCtx.strokeRect(sx + offset, sy, stoneW - 1, stoneH - 1);
					mgCtx.beginPath(); mgCtx.moveTo(sx + offset, sy + stoneH - 1); mgCtx.lineTo(sx + offset, sy); mgCtx.lineTo(sx + offset + stoneW - 1, sy);
					mgCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; mgCtx.stroke();
				}
			}
			mgCtx.restore();

			const drawWall = (y, width, height, isTop) => {
				mgCtx.fillStyle = isTop ? blackWallGrad : wallGrad; mgCtx.fillRect(cx - width/2, y - height, width, height);
				mgCtx.save(); mgCtx.fillStyle = isTop ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.05)';
				const pores = Math.floor(width * 1.5);
				for (let i = 0; i < pores; i++) { mgCtx.fillRect(cx - width/2 + (Math.abs(Math.sin(y * 0.02 + i * 3.14)) * width), y - (Math.abs(Math.cos(y * 0.02 + i * 2.71)) * height), 1.5, 1.5); }
				mgCtx.strokeStyle = isTop ? 'rgba(255, 255, 255, 0.05)' : 'rgba(20, 15, 10, 0.08)';
				mgCtx.lineWidth = 0.8; mgCtx.beginPath(); const veins = Math.floor(width / 5);
				for (let i = 0; i < veins; i++) {
					let vx = cx - width/2 + (Math.abs(Math.sin(y * 0.01 + i * 12.34)) * width); let vy = y - (Math.abs(Math.cos(y * 0.01 + i * 7.89)) * height); mgCtx.moveTo(vx, vy);
					for (let s = 1; s <= 3; s++) { vx += Math.sin(vx * 0.05 + i) * 12; vy += Math.cos(vy * 0.05 + s) * 12; if (vx > cx - width/2 && vx < cx + width/2 && vy > y - height && vy < y) mgCtx.lineTo(vx, vy); }
				}
				mgCtx.stroke(); mgCtx.restore();
				mgCtx.fillStyle = isTop ? '#111' : 'rgba(0, 0, 0, 0.1)';
				const pillars = 4; const pSpace = width / pillars;
				for(let i = 1; i < pillars; i++) mgCtx.fillRect(cx - width/2 + (i * pSpace) - 1.5, y - height, 3, height);
				const winW = w * 0.025; const winH = height * 0.4; const winY = y - height * 0.75;
				for(let i = 1; i < pillars; i++) {
					const winX = cx - width/2 + (i * pSpace) - (winW/2);
					mgCtx.fillStyle = goldGrad; mgCtx.fillRect(winX - 2, winY - 2, winW + 4, winH + 4);
					mgCtx.fillStyle = '#1c1c1c'; mgCtx.fillRect(winX, winY, winW, winH);
					mgCtx.fillStyle = '#0a0a0a'; mgCtx.fillRect(winX + winW/2 - 0.5, winY, 1, winH); mgCtx.fillRect(winX, winY + winH/2 - 0.5, winW, 1); 
				}
			};

			const drawEaveShadow = (y, width) => {
				let shadow = mgCtx.createLinearGradient(0, y, 0, y + h*0.04);
				shadow.addColorStop(0, 'rgba(10, 15, 12, 0.95)'); shadow.addColorStop(1, 'rgba(10, 15, 12, 0)');
				mgCtx.fillStyle = shadow; mgCtx.fillRect(cx - width/2, y, width, h*0.04);
				mgCtx.fillStyle = goldGrad;
				for(let rx = cx - width/2 + w*0.01; rx < cx + width/2; rx += w*0.015) { mgCtx.fillRect(rx, y, w*0.004, h*0.008); }
			};

			const drawRoof = (y, wTop, wBot, height) => {
				mgCtx.beginPath(); mgCtx.moveTo(cx - wBot/2, y); mgCtx.quadraticCurveTo(cx - wTop/2 * 1.2, y - height * 0.7, cx - wTop/2, y - height); 
				mgCtx.lineTo(cx + wTop/2, y - height); mgCtx.quadraticCurveTo(cx + wTop/2 * 1.2, y - height * 0.7, cx + wBot/2, y); 
				mgCtx.lineTo(cx + wBot/2 - w*0.015, y + h*0.01); mgCtx.lineTo(cx - wBot/2 + w*0.015, y + h*0.01); mgCtx.fillStyle = roofGrad; mgCtx.fill();
				mgCtx.save(); mgCtx.clip(); mgCtx.strokeStyle = 'rgba(15, 30, 25, 0.4)'; mgCtx.lineWidth = 1.5; mgCtx.beginPath();
				for(let i = -wBot/2; i <= wBot/2; i += w*0.012) { const topDist = (i / (wBot/2)) * (wTop/2); mgCtx.moveTo(cx + topDist, y - height); mgCtx.quadraticCurveTo(cx + topDist * 1.1, y - height * 0.5, cx + i, y + h*0.01); }
				mgCtx.stroke(); mgCtx.restore();
				mgCtx.fillStyle = goldGrad; mgCtx.beginPath(); mgCtx.moveTo(cx - wBot/2, y); mgCtx.lineTo(cx + wBot/2, y);
				mgCtx.lineTo(cx + wBot/2 - w*0.005, y + h*0.004); mgCtx.lineTo(cx - wBot/2 + w*0.005, y + h*0.004); mgCtx.fill();
				mgCtx.fillRect(cx - wBot/2 - w*0.002, y - h*0.005, w*0.008, h*0.01); mgCtx.fillRect(cx + wBot/2 - w*0.006, y - h*0.005, w*0.008, h*0.01);
			};

			const drawGable = (y, width, height, type) => {
				mgCtx.fillStyle = goldGrad; mgCtx.beginPath();
				if (type === 'triangle') {
					mgCtx.moveTo(cx - width/2, y); mgCtx.lineTo(cx, y - height); mgCtx.lineTo(cx + width/2, y);
					mgCtx.lineTo(cx + width/2 - w*0.01, y + h*0.005); mgCtx.lineTo(cx, y - height + h*0.015); mgCtx.lineTo(cx - width/2 + w*0.01, y + h*0.005);
				} else if (type === 'curve') {
					mgCtx.moveTo(cx - width/2, y); mgCtx.bezierCurveTo(cx - width*0.2, y - height, cx + width*0.2, y - height, cx + width/2, y);
					mgCtx.lineTo(cx + width/2 - w*0.005, y + h*0.005); mgCtx.bezierCurveTo(cx + width*0.2, y - height + h*0.01, cx - width*0.2, y - height + h*0.01, cx - width/2 + w*0.005, y + h*0.005);
				}
				mgCtx.fill(); mgCtx.fillStyle = wallGrad; mgCtx.fill();
				mgCtx.fillStyle = goldGrad; mgCtx.beginPath(); mgCtx.arc(cx, y - height*0.4, w*0.015, 0, Math.PI*2); mgCtx.fill();
				mgCtx.fillStyle = '#2a2622'; mgCtx.fillRect(cx - w*0.015, y - height*0.25, w*0.03, height*0.15);
			};

			let ty1 = baseY; drawWall(ty1, w*0.34, h*0.1, false); drawEaveShadow(ty1 - h*0.1, w*0.34); drawRoof(ty1 - h*0.1, w*0.2, w*0.42, h*0.06);
			let ty2 = ty1 - h*0.14; drawWall(ty2, w*0.28, h*0.08, false); drawEaveShadow(ty2 - h*0.08, w*0.28); drawRoof(ty2 - h*0.08, w*0.16, w*0.36, h*0.06); drawGable(ty2 - h*0.06, w*0.22, h*0.08, 'triangle'); 
			let ty3 = ty2 - h*0.12; drawWall(ty3, w*0.22, h*0.08, false); drawEaveShadow(ty3 - h*0.08, w*0.22); drawRoof(ty3 - h*0.08, w*0.13, w*0.28, h*0.05); drawGable(ty3 - h*0.06, w*0.14, h*0.04, 'curve'); 
			let ty4 = ty3 - h*0.11; drawWall(ty4, w*0.16, h*0.09, true);
			mgCtx.fillStyle = goldGrad; mgCtx.fillRect(cx - w*0.09, ty4 - h*0.02, w*0.18, h*0.015); mgCtx.fillStyle = '#1a1a1a'; mgCtx.fillRect(cx - w*0.085, ty4 - h*0.015, w*0.17, h*0.005); 
			drawEaveShadow(ty4 - h*0.09, w*0.16); drawRoof(ty4 - h*0.09, w*0.1, w*0.22, h*0.06); drawGable(ty4 - h*0.07, w*0.1, h*0.05, 'triangle'); 
			mgCtx.fillStyle = goldGrad; let peakY = ty4 - h*0.15;
			mgCtx.beginPath(); mgCtx.moveTo(cx - w*0.04, peakY); mgCtx.quadraticCurveTo(cx - w*0.06, peakY - h*0.04, cx - w*0.03, peakY - h*0.05); mgCtx.quadraticCurveTo(cx - w*0.04, peakY - h*0.02, cx - w*0.045, peakY); mgCtx.fill();
			mgCtx.beginPath(); mgCtx.moveTo(cx + w*0.04, peakY); mgCtx.quadraticCurveTo(cx + w*0.06, peakY - h*0.04, cx + w*0.03, peakY - h*0.05); mgCtx.quadraticCurveTo(cx + w*0.04, peakY - h*0.02, cx + w*0.045, peakY); mgCtx.fill();

			for(let i=0; i<45; i++) {
				this.bgState.fallingPetals.push({
					x: w * 0.85 - Math.random() * (w * 0.95), y: baseY + h * 0.05 + (Math.random() - 0.5) * h * 0.2,
					s: Math.random() * 2 + 1.5, a: Math.random() * Math.PI * 2,
					vx: Math.random() * 0.8 + 0.3, vy: Math.random() * 0.6 + 0.3, spin: (Math.random() - 0.5) * 0.05
				});
			}
		}

		// --- 2. DYNAMIC RENDERING LOOP ---
		ctx.globalAlpha = Math.min(1, t / 600);
		ctx.drawImage(this.bgState.skyCache, 0, 0);

		ctx.save();
		ctx.globalCompositeOperation = 'overlay';
		const rayOriginX = w * 1.3; const rayOriginY = -h * 0.5; 
		ctx.fillStyle = this.bgState.rayGrad;
		this.bgState.rays.forEach(ray => {
			const angle = Math.sin(this.elapsed * ray.speed + ray.angleOffset) * 0.6 + ray.angleOffset;
			ctx.globalAlpha = ray.op * Math.min(1, t / 600);
			ctx.translate(rayOriginX, rayOriginY); ctx.rotate(angle);
			ctx.beginPath();
			ctx.moveTo(-w * ray.width, 0); ctx.lineTo(w * ray.width, 0); ctx.lineTo(w * ray.width * 2, h * 3); ctx.lineTo(-w * ray.width * 2, h * 3);
			ctx.fill();
			ctx.rotate(-angle); ctx.translate(-rayOriginX, -rayOriginY);
		});
		ctx.restore();

		const castleScale = this.getPopScale(t, 200, 800);
		if (castleScale > 0) {
			ctx.save();
			ctx.translate(cx, baseY);
			ctx.scale(castleScale, castleScale);
			ctx.translate(-cx, -baseY);
			ctx.drawImage(this.bgState.midgroundCache, 0, 0);

			// --- EASTER EGG: BEN & SAM (TOP OF THE WORLD) ---
			// Only render if they won the 1 in 20 roll during initialization!
			if (this.bgState.showEasterEgg) {
				const peakY = baseY - h*0.14 - h*0.12 - h*0.11 - h*0.15;
				const coupleX = cx + 40; 
				const coupleY = peakY;

				const sway = Math.sin(this.elapsed * 0.001) * 0.04;
				const breath = Math.sin(this.elapsed * 0.0015) * h*0.0005;

				ctx.save();
				ctx.translate(coupleX, coupleY);
				ctx.scale(2.0, 2.0); 

				const u = w * 0.001; 
				const v = h * 0.001;

				// 1. Ben's Body & Head
				ctx.save();
				ctx.translate(-u * 1.5, breath);
				ctx.rotate(sway + 0.1); 
				
				ctx.fillStyle = '#1c2833'; 
				ctx.fillRect(-u * 1.8, -v * 16, u * 3.6, v * 16); 
				ctx.beginPath(); ctx.arc(0, -v * 16, u * 1.8, Math.PI, 0); ctx.fill();
				
				ctx.fillStyle = '#f5d6c6'; 
				ctx.beginPath(); ctx.arc(0, -v * 20, u * 1.5, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = '#111';
				ctx.beginPath(); ctx.arc(0, -v * 20.5, u * 1.6, Math.PI * 0.8, Math.PI * 2.2); ctx.fill();
				ctx.restore();

				// 2. Sam's Body, Head & Hair
				ctx.save();
				ctx.translate(u * 1.5, breath * 1.1); 
				ctx.rotate(sway - 0.2); 
				
				ctx.fillStyle = '#2c3e50'; 
				ctx.fillRect(-u * 1.5, -v * 13, u * 3, v * 13); 
				ctx.beginPath(); ctx.arc(0, -v * 13, u * 1.5, Math.PI, 0); ctx.fill(); 
				
				ctx.fillStyle = '#fce2d5'; 
				ctx.beginPath(); ctx.arc(0, -v * 16, u * 1.4, 0, Math.PI * 2); ctx.fill();
				
				ctx.fillStyle = '#640000';
				ctx.beginPath(); ctx.arc(0, -v * 16.5, u * 1.6, Math.PI * 0.8, Math.PI * 2.5); ctx.fill(); 
				ctx.beginPath();
				ctx.moveTo(u * 0.5, -v * 16.5);
				ctx.bezierCurveTo(u * 2, -v * 10, u * 2, -v * 6, u * 1.2, -v * 2);
				ctx.lineTo(-u * 0.2, -v * 2);
				ctx.lineTo(-u * 1.2, -v * 16.5);
				ctx.fill();
				ctx.restore();

				// 3. Ben's Arm (NATURAL WRAP)
				ctx.save();
				ctx.translate(-u * 1.5, breath);
				ctx.rotate(sway + 0.1); 
				
				ctx.strokeStyle = '#1c2833'; 
				ctx.lineWidth = u * 1.5; 
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				
				ctx.beginPath();
				ctx.moveTo(0, -v * 14.5);
				ctx.bezierCurveTo(u * 1.5, -v * 11.5, u * 2.8, -v * 12.5, u * 3.5, -v * 13.8);
				ctx.stroke();
				
				ctx.restore();

				ctx.restore();
			}
			// --- END EASTER EGG ---

			ctx.restore();
		}

		if (this.bgState.ornaments) {
			const renderOrnament = (anchorX, anchorY, ornData) => {
				if (!ornData) return;
				const angle = Math.sin(this.elapsed * ornData.speed + ornData.phase) * ornData.angleAmp;
				ctx.save();
				ctx.translate(anchorX, anchorY);
				ctx.scale(castleScale, castleScale);                
				ctx.rotate(angle);
				ctx.strokeStyle = '#8b6508'; ctx.lineWidth = 1;
				ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, ornData.length); ctx.stroke();
				ctx.translate(0, ornData.length);
				ctx.drawImage(this.bgState.ornamentSprite, -this.bgState.ornamentSprite.width/2, 0);
				ctx.restore();
			};

			const dynBaseY = h - h*0.22;
			const tiers = [ { y: dynBaseY - h*0.1,  wBot: w*0.42 }, { y: dynBaseY - h*0.14 - h*0.08, wBot: w*0.36 }, { y: dynBaseY - h*0.14 - h*0.12 - h*0.08, wBot: w*0.28 }, { y: dynBaseY - h*0.14 - h*0.12 - h*0.11 - h*0.09, wBot: w*0.22 } ];
			tiers.forEach((tier, index) => {
				renderOrnament(cx - tier.wBot/2 + w*0.002, tier.y, this.bgState.ornaments[index * 2]);
				renderOrnament(cx + tier.wBot/2 - w*0.002, tier.y, this.bgState.ornaments[index * 2 + 1]);
			});
		}

		let bird = this.bgState.bird;
		if (!bird.active && this.elapsed > bird.nextSpawn && t > 2000) {
			bird.active = true; bird.type = Math.random() > 0.5 ? 'depart' : 'arrive'; 
			const birdColors = ['#407294', '#947b29', '#8c8881', '#f2f2f2'];
			bird.color = birdColors[Math.floor(Math.random() * birdColors.length)];
			bird.flapSpeed = 25 + Math.random() * 15; bird.scale = w * 0.0015 + Math.random() * w * 0.0015; 
			bird.swoopPhaseX = Math.random() * Math.PI * 2; bird.swoopPhaseY = Math.random() * Math.PI * 2;
			bird.swoopRateX = 0.001 + Math.random() * 0.001; bird.swoopRateY = 0.0008 + Math.random() * 0.001;
			if (bird.type === 'depart') { bird.x = cx - w * 0.3 + Math.random() * w * 0.6; bird.y = baseY + h * 0.1; bird.baseVx = (Math.random() - 0.5) * w * 0.0025; bird.baseVy = -h * 0.002 - Math.random() * h * 0.0015; } else { bird.x = cx - w * 0.4 + Math.random() * w * 0.8; bird.y = -h * 0.1; bird.baseVx = (Math.random() - 0.5) * w * 0.0025; bird.baseVy = h * 0.002 + Math.random() * h * 0.0015; }
		}

		if (bird.active) {
			let swoopX = Math.sin(this.elapsed * bird.swoopRateX + bird.swoopPhaseX) * w * 0.0015;
			let swoopY = Math.cos(this.elapsed * bird.swoopRateY + bird.swoopPhaseY) * h * 0.001;
			let currentVx = bird.baseVx + swoopX; let currentVy = bird.baseVy + swoopY;
			bird.x += currentVx; bird.y += currentVy;
			ctx.save(); ctx.translate(bird.x, bird.y); ctx.rotate(Math.atan2(currentVy, currentVx));
			const flap = Math.sin(this.elapsed * 0.001 * bird.flapSpeed); 
			ctx.fillStyle = bird.color;
			ctx.beginPath(); ctx.moveTo(-bird.scale * 1.5, bird.scale * 0.5); ctx.lineTo(-bird.scale * 3, bird.scale * 1.5); ctx.lineTo(-bird.scale * 2.5, 0); ctx.lineTo(-bird.scale * 3, -bird.scale * 1.5); ctx.lineTo(-bird.scale * 1.5, -bird.scale * 0.5); ctx.fill();
			ctx.beginPath(); ctx.ellipse(0, 0, bird.scale * 2, bird.scale * 0.8, 0, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.moveTo(bird.scale, 0); ctx.quadraticCurveTo(-bird.scale, -bird.scale * 4 + (flap * bird.scale * 3), -bird.scale * 1.5, -bird.scale * 5 + (flap * bird.scale * 4)); ctx.lineTo(-bird.scale, 0); ctx.fill();
			ctx.beginPath(); ctx.moveTo(bird.scale, 0); ctx.quadraticCurveTo(-bird.scale, bird.scale * 4 - (flap * bird.scale * 3), -bird.scale * 1.5, bird.scale * 5 - (flap * bird.scale * 4)); ctx.lineTo(-bird.scale, 0); ctx.fill();
			ctx.restore();
			if ((bird.type === 'depart' && bird.y < -h * 0.1) || (bird.type === 'arrive' && bird.y > baseY + h * 0.15) || (bird.x < -w * 0.2 || bird.x > w * 1.2)) { bird.active = false; bird.nextSpawn = this.elapsed + 20000 + Math.random() * 25000; }
		}

		const globalTime = this.elapsed * 0.0008; 
		const windForce = Math.sin(globalTime * 0.5) * 0.3 + 0.7; 
		for (let branch of this.bgState.sakuraBranches) {
			if (branch.popDelay === undefined) branch.popDelay = 400 + Math.random() * 600;
			const bScale = this.getPopScale(t, branch.popDelay, 600);
			if (bScale === 0) continue;
			const swayX = Math.sin(globalTime * 1.5 + branch.macroPhase) * (branch.baseR * 0.06) * windForce; 
			const swayY = Math.cos(globalTime * 1.1 + branch.macroPhase) * (branch.baseR * 0.02) * windForce; 
			const swayRot = Math.sin(globalTime * 3.0 + branch.microPhase) * 0.08 * windForce;
			ctx.save(); ctx.translate(branch.cx + swayX, branch.cy + swayY); ctx.rotate(swayRot);
			const drawSize = branch.baseR * 2.8 * bScale;
			ctx.drawImage(branch.sprite, -drawSize/2, -drawSize/2, drawSize, drawSize); ctx.restore();
		}

		for (let petal of this.bgState.fallingPetals) {
			if (t < 1000) break;
			petal.x -= petal.vx; petal.y += petal.vy; petal.a += petal.spin; 
			if (petal.y > h + 20 || petal.x < -w * 0.15) {
				const dynBaseY = h - h*0.22;
				petal.x = w * 0.85 - Math.random() * (w * 0.5); petal.y = dynBaseY + h * 0.05 - Math.random() * h * 0.15; 
				petal.vx = Math.random() * 0.8 + 0.3; petal.vy = Math.random() * 0.6 + 0.3;
			}
			ctx.save(); ctx.translate(petal.x, petal.y); ctx.rotate(petal.a);
			ctx.drawImage(this.bgState.petalSprite, -petal.s, -petal.s, petal.s * 2, petal.s * 2);
			ctx.restore();
		}
	},
	
	drawNagoya: function(dt) {
		const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height;
		const horizon = h * 0.45;
		
		const safeDt = Math.min(dt, 32);
		this.bgState.introTimer = (this.bgState.introTimer || 0) + safeDt;
		const t = this.bgState.introTimer;
		
		// --- 1. CACHE STATIC ELEMENTS & PROPS ---
		if (!this.bgState.nagoyaCache || this.bgState.nagoyaCache.width !== w || this.bgState.nagoyaCache.height !== h || !this.bgState.nagoyaUmbrellas || this.bgState.nagoyaUmbrellas[0].popDelay === undefined) {
			
			this.bgState.nagoyaCache = document.createElement('canvas');
			this.bgState.nagoyaCache.width = w; this.bgState.nagoyaCache.height = h;
			const oCtx = this.bgState.nagoyaCache.getContext('2d');

			// Variable to handle the dice roll for the Nagoya easter egg
			this.bgState.showEasterEgg = Math.random() < 0.05;

			// A. Sweltering Sky
			let skyGrad = oCtx.createLinearGradient(0, 0, 0, h * 0.5);
			skyGrad.addColorStop(0, '#e65c00'); skyGrad.addColorStop(1, '#F9D423'); 
			oCtx.fillStyle = skyGrad; oCtx.fillRect(0, 0, w, h);

			// B. Base Ocean
			let cacheOceanGrad = oCtx.createLinearGradient(0, horizon, 0, h*0.8);
			cacheOceanGrad.addColorStop(0, '#005c97'); cacheOceanGrad.addColorStop(1, '#36D1DC'); 
			oCtx.fillStyle = cacheOceanGrad;
			oCtx.beginPath(); oCtx.moveTo(0, horizon); oCtx.lineTo(w, horizon); oCtx.lineTo(w, h*0.75); oCtx.quadraticCurveTo(w*0.5, h*0.85, 0, h*0.7); oCtx.fill();

			// C. Sand Beach
			let sandGrad = oCtx.createLinearGradient(0, h*0.7, 0, h);
			sandGrad.addColorStop(0, '#e8c396'); sandGrad.addColorStop(1, '#d4a373'); 
			oCtx.fillStyle = sandGrad;
			oCtx.beginPath(); oCtx.moveTo(0, h*0.7); oCtx.quadraticCurveTo(w*0.5, h*0.85, w, h*0.75); oCtx.lineTo(w, h); oCtx.lineTo(0, h); oCtx.fill();

			// D. Sand Texture
			oCtx.fillStyle = 'rgba(139, 69, 19, 0.08)'; 
			for(let i = 0; i < 3000; i++) { oCtx.fillRect(Math.random() * w, h*0.7 + Math.random() * h*0.3, 1.5, 1.5); }
			oCtx.fillStyle = 'rgba(255, 255, 255, 0.15)'; 
			for(let i = 0; i < 2000; i++) { oCtx.fillRect(Math.random() * w, h*0.7 + Math.random() * h*0.3, 1.5, 1.5); }

			// E. Calculate Beach Props (Umbrellas)
			this.bgState.nagoyaUmbrellas = [];
			const numUmbrellas = 12; const segmentW = (w * 0.9) / numUmbrellas; 
			for(let i = 0; i < numUmbrellas; i++) {
				let ux = (w * 0.05) + (i * segmentW) + (Math.random() * segmentW * 0.7);
				let t = ux / w; let shoreY = Math.pow(1-t, 2)*(h*0.7) + 2*(1-t)*t*(h*0.85) + Math.pow(t, 2)*(h*0.75);
				let uy = shoreY + h * 0.01 + Math.random() * h * 0.05; 
				let size = w * 0.015 + Math.random() * w * 0.01;
				let color = (Math.random() > 0.5) ? { base: '#e74c3c', rib: '#f1948a', cap: '#444' } : { base: '#3498db', rib: '#85c1e9', cap: '#444' };
				let tilt = (Math.random() - 0.5) * (Math.PI / 9);
				let popDelay = 600 + (i * 40); 
				this.bgState.nagoyaUmbrellas.push({ ux, uy, size, color, tilt, popDelay });
			}
			this.bgState.nagoyaUmbrellas.sort((a, b) => a.uy - b.uy);

			// F. Calculate dynamic Distant Buildings for sweeping pop-in
			this.bgState.nagoyaDistantBuildings = [];
			for(let i = 0; i < 25; i++) {
				let bx = w * Math.random();
				let bw = w * 0.01 + Math.random() * w * 0.02;
				let bh = h * 0.02 + Math.random() * h * 0.05;
				// Sweep left to right across the horizon
				let popDelay = 600 + (bx / w) * 600; 
				this.bgState.nagoyaDistantBuildings.push({ bx, bw, bh, popDelay });
			}
		}

		// --- PRE-CALCULATE POP SCALES & SUN LOGIC ---
		const sunPulse = Math.sin(this.elapsed * 0.0002) * (w*0.002); 
		const sunX = w * 0.15; const sunY = h * 0.20; const baseRadius = w * 0.05; 
		const auraPulse = Math.sin(this.elapsed * 0.0001) * 0.02; 
		
		const envScale = this.getPopScale(t, 0, 700);
		const sunScale = this.getPopScale(t, 400, 500); 
		const hillScale = this.getPopScale(t, 400, 700); // Mountains spring up as horizon unfolds

		function drawSunCoreAndAura(targetCtx, sX, sY, bR, pulse, aP) {
			const auraGrad = targetCtx.createRadialGradient(sX, sY, bR, sX, sY, w * 0.16);
			auraGrad.addColorStop(0, 'rgba(255, 242, 0, 0.5)'); auraGrad.addColorStop(0.3 + aP, 'rgba(255, 140, 0, 0.15)'); 
			auraGrad.addColorStop(0.6, 'rgba(255, 100, 0, 0.05)'); auraGrad.addColorStop(1, 'rgba(255, 100, 0, 0)'); 
			targetCtx.fillStyle = auraGrad; targetCtx.beginPath(); targetCtx.arc(sX, sY, w * 0.16, 0, Math.PI * 2); targetCtx.fill();
			const coreGrad = targetCtx.createRadialGradient(sX, sY, 0, sX, sY, bR + pulse);
			coreGrad.addColorStop(0, '#FFFFFF'); coreGrad.addColorStop(0.5, '#FFFBDE'); coreGrad.addColorStop(1, '#FFF200'); 
			targetCtx.fillStyle = coreGrad; targetCtx.beginPath(); targetCtx.arc(sX, sY, bR + pulse, 0, Math.PI * 2); targetCtx.fill();
		}

		// --- 2. UPDATE OFFSCREEN CANVASES ---
		if (!this.bgState.reflectUpperCanvas) {
			this.bgState.reflectUpperCanvas = document.createElement('canvas'); this.bgState.reflectUpperCanvas.width = w; this.bgState.reflectUpperCanvas.height = h;
			this.bgState.reflectTextureCanvas = document.createElement('canvas'); this.bgState.reflectTextureCanvas.width = w; this.bgState.reflectTextureCanvas.height = h;
			this.bgState.reflectRippledCanvas = document.createElement('canvas'); this.bgState.reflectRippledCanvas.width = w; this.bgState.reflectRippledCanvas.height = h;
		}

		const reflectUpperCtx = this.bgState.reflectUpperCanvas.getContext('2d');
		reflectUpperCtx.clearRect(0, 0, w, h);
		reflectUpperCtx.drawImage(this.bgState.nagoyaCache, 0, 0); 

		// Draw popping Hills into the reflection!
		if (hillScale > 0) {
			reflectUpperCtx.save();
			reflectUpperCtx.translate(0, horizon); reflectUpperCtx.scale(1, hillScale); reflectUpperCtx.translate(0, -horizon);
			reflectUpperCtx.fillStyle = '#4a2c11'; 
			reflectUpperCtx.beginPath(); reflectUpperCtx.moveTo(0, horizon); reflectUpperCtx.lineTo(w*0.2, horizon - h*0.05); reflectUpperCtx.lineTo(w*0.4, horizon - h*0.02); reflectUpperCtx.lineTo(w*0.7, horizon - h*0.08); reflectUpperCtx.lineTo(w, horizon); reflectUpperCtx.fill();
			reflectUpperCtx.restore();
		}

		// Draw popping Distant Buildings into the reflection!
		reflectUpperCtx.fillStyle = '#3d240e';
		this.bgState.nagoyaDistantBuildings.forEach(b => {
			const bScale = this.getPopScale(t, b.popDelay, 500);
			if (bScale > 0) {
				reflectUpperCtx.save();
				reflectUpperCtx.translate(b.bx + b.bw/2, horizon); reflectUpperCtx.scale(1, bScale); reflectUpperCtx.translate(-(b.bx + b.bw/2), -horizon);
				reflectUpperCtx.fillRect(b.bx, horizon - b.bh, b.bw, b.bh);
				reflectUpperCtx.restore();
			}
		});

		if (sunScale > 0) {
			reflectUpperCtx.save();
			reflectUpperCtx.translate(sunX, sunY); reflectUpperCtx.scale(sunScale, sunScale); reflectUpperCtx.translate(-sunX, -sunY);
			drawSunCoreAndAura(reflectUpperCtx, sunX, sunY, baseRadius, sunPulse, auraPulse);
			const simplifiedGlintGrad = reflectUpperCtx.createRadialGradient(sunX, sunY, baseRadius, sunX, sunY, w * 0.12);
			simplifiedGlintGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)'); simplifiedGlintGrad.addColorStop(0.3, 'rgba(255, 242, 0, 0.2)'); simplifiedGlintGrad.addColorStop(1, 'rgba(255, 242, 0, 0)');
			reflectUpperCtx.translate(sunX, sunY); reflectUpperCtx.rotate(this.elapsed * 0.00015); reflectUpperCtx.fillStyle = simplifiedGlintGrad;
			reflectUpperCtx.beginPath(); reflectUpperCtx.arc(0, 0, w * 0.12, 0, Math.PI * 2); reflectUpperCtx.fill();
			reflectUpperCtx.restore();
		}

		const reflectTextureCtx = this.bgState.reflectTextureCanvas.getContext('2d');
		reflectTextureCtx.clearRect(0, 0, w, h); reflectTextureCtx.save(); reflectTextureCtx.translate(0, 2 * horizon); reflectTextureCtx.scale(1, -1);
		reflectTextureCtx.drawImage(this.bgState.reflectUpperCanvas, 0, 0); reflectTextureCtx.restore();

		const reflectRippledCtx = this.bgState.reflectRippledCanvas.getContext('2d');
		reflectRippledCtx.clearRect(0, 0, w, h);
		const shorelineY = horizon + (h * 0.25); const sliceHReflect = 2; const reflectTime = this.elapsed * 0.0003; 
		const tiltTan = Math.tan(32 * (Math.PI / 180)); 

		reflectRippledCtx.save();
		for (let y = horizon; y < shorelineY; y += sliceHReflect) {
			const phase = (y - horizon) / (shorelineY - horizon);
			reflectRippledCtx.globalAlpha = 1 - Math.pow(phase, 2.0);
			const reflectShiftX = ((Math.sin(y * 0.311 - reflectTime * 2.13) + Math.cos(y * 0.197 + reflectTime * 2.77) * 0.5 + Math.sin(y * 0.083 + reflectTime * 0.91) * 0.2) * 12 * phase); 
			const totalShiftX = reflectShiftX + ((y - horizon) * tiltTan);
			const reflectShiftY = ((Math.sin(y * 0.239 - reflectTime * 1.63) + Math.cos(y * 0.419 + reflectTime * 1.17) * 0.4) * 9.2 * phase);
			let srcY = Math.max(0, Math.min(h - sliceHReflect, y + reflectShiftY));

			reflectRippledCtx.drawImage(this.bgState.reflectTextureCanvas, 0, srcY, w, sliceHReflect, totalShiftX, y, w, sliceHReflect);
			if (totalShiftX > 0) { reflectRippledCtx.drawImage(this.bgState.reflectTextureCanvas, 0, srcY, 1, sliceHReflect, 0, y, Math.ceil(totalShiftX) + 1, sliceHReflect); } 
			else if (totalShiftX < 0) { reflectRippledCtx.drawImage(this.bgState.reflectTextureCanvas, w - 1, srcY, 1, sliceHReflect, w + Math.floor(totalShiftX), y, Math.ceil(Math.abs(totalShiftX)) + 1, sliceHReflect); }
		}
		const reflectHueGrad = reflectRippledCtx.createLinearGradient(0, horizon, 0, h*0.8);
		reflectHueGrad.addColorStop(0, 'rgba(0, 92, 151, 0.2)'); reflectHueGrad.addColorStop(1, 'rgba(54, 209, 220, 0.2)'); 
		reflectRippledCtx.fillStyle = reflectHueGrad; reflectRippledCtx.globalCompositeOperation = 'source-atop'; 
		reflectRippledCtx.fillRect(0, horizon, w, shorelineY - horizon); reflectRippledCtx.restore();

		// --- 3. MAIN CANVAS RENDERING ---
		if (envScale === 0) return; // Wait for the intro

		ctx.save();
		ctx.translate(w/2, horizon);
		ctx.scale(1, Math.max(0.001, envScale)); 
		ctx.translate(-w/2, -horizon);

		// A. Haze slices (Applies to Sky)
		const hazeStartY = h * 0.25; const hazeEndY = h * 0.55;   
		ctx.drawImage(this.bgState.nagoyaCache, 0, 0, w, hazeStartY, 0, 0, w, hazeStartY);
		const waveTime = this.elapsed * 0.0008; 
		for (let y = hazeStartY; y < hazeEndY; y += 2) {
			const intensity = Math.max(0, 1 - (Math.abs(y - horizon) / ((hazeEndY - hazeStartY) / 2)));
			const shiftX = (Math.sin(y * 0.15 - waveTime * 2.5) + Math.cos(y * 0.28 + waveTime * 3.0) * 0.6 + Math.sin(y * 0.05 + waveTime * 1.5) * 0.4) * 0.4 * intensity; 
			ctx.drawImage(this.bgState.nagoyaCache, 0, y, w, 2, shiftX, y, w, 2);
		}
		ctx.drawImage(this.bgState.nagoyaCache, 0, hazeEndY, w, h - hazeEndY, 0, hazeEndY, w, h - hazeEndY);

		// Draw Hills directly to Main Canvas!
		if (hillScale > 0) {
			ctx.save();
			ctx.translate(0, horizon); ctx.scale(1, hillScale); ctx.translate(0, -horizon);
			ctx.fillStyle = '#4a2c11'; 
			ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(w*0.2, horizon - h*0.05); ctx.lineTo(w*0.4, horizon - h*0.02); ctx.lineTo(w*0.7, horizon - h*0.08); ctx.lineTo(w, horizon); ctx.fill();
			ctx.restore();
		}

		// Draw Distant Buildings directly to Main Canvas!
		ctx.fillStyle = '#3d240e';
		this.bgState.nagoyaDistantBuildings.forEach(b => {
			const bScale = this.getPopScale(t, b.popDelay, 500);
			if (bScale > 0) {
				ctx.save();
				ctx.translate(b.bx + b.bw/2, horizon); ctx.scale(1, bScale); ctx.translate(-(b.bx + b.bw/2), -horizon);
				ctx.fillRect(b.bx, horizon - b.bh, b.bw, b.bh);
				ctx.restore();
			}
		});

		// B. Draw Dynamic Water & Foam
		ctx.save();
		ctx.beginPath(); ctx.moveTo(0, h * 0.45); ctx.lineTo(w, h * 0.45); ctx.lineTo(w, h * 0.75); ctx.quadraticCurveTo(w * 0.5, h * 0.85, 0, h * 0.7); ctx.clip();
		let dynamicOceanGrad = ctx.createLinearGradient(0, horizon, 0, h*0.8);
		dynamicOceanGrad.addColorStop(0, '#005c97'); dynamicOceanGrad.addColorStop(1, '#36D1DC'); 
		ctx.fillStyle = dynamicOceanGrad; ctx.fill(); 
		ctx.drawImage(this.bgState.reflectRippledCanvas, 0, 0);

		for (let i = 0; i < 6; i++) {
			let phase = ((this.elapsed * 0.00005) + (i / 6)) % 1; let yFactor = Math.pow(phase, 1.8); let waveY = h * 0.45 + (yFactor * h * 0.35); 
			let amp = yFactor * 8; let freq = 0.015 + (1 - yFactor) * 0.04; 
			ctx.beginPath();
			for (let x = 0; x <= w; x += 15) {
				let localizedAmp = amp * (0.8 + 0.5 * Math.sin(x * 0.008 - this.elapsed * 0.0001 + i * 2.1));
				let y = waveY + (Math.sin(x * freq + this.elapsed * 0.0003) + Math.cos(x * freq * 3.5 - this.elapsed * 0.0006) * 0.35 + Math.sin(x * freq * 1.5 + this.elapsed * 0.0002 + i) * 0.5) * localizedAmp;
				if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + (yFactor * 0.35)})`; ctx.lineWidth = 1 + yFactor * 3.5; ctx.stroke();
		}
		ctx.restore(); 

		const lapOffset = Math.sin(this.elapsed * 0.00008) * h * 0.004; 
		ctx.fillStyle = 'rgba(175, 238, 238, 0.3)'; ctx.beginPath();
		for (let x = 0; x <= w + 20; x += 10) {
			let t = x / w; let foamY = (Math.pow(1-t, 2)*(h*0.7) + 2*(1-t)*t*(h*0.85) + Math.pow(t, 2)*(h*0.75)) + lapOffset + (Math.sin(x * 0.04 + this.elapsed * 0.0001) * h * 0.008); 
			ctx.moveTo(x, foamY); ctx.arc(x, foamY, w*0.012 + Math.cos(x * 0.08) * w*0.003, 0, Math.PI*2);
		}
		ctx.fill();

		// C. Pop the Sun!
		if (sunScale > 0) {
			ctx.save();
			ctx.translate(sunX, sunY); ctx.scale(sunScale, sunScale); ctx.translate(-sunX, -sunY);
			drawSunCoreAndAura(ctx, sunX, sunY, baseRadius, sunPulse, auraPulse);
			
			ctx.save(); ctx.globalCompositeOperation = 'lighter'; 
			for (let i = 0; i < 8; i++) {
				const angle = ((i / 8) * Math.PI * 2) + (this.elapsed * 0.00006); 
				const pulseLen = Math.cos(this.elapsed * 0.0003 + i * 1.3) * (w * 0.006);
				const flicker = 0.4 + Math.sin(this.elapsed * 0.0006 + i * 0.7) * 0.3;
				const startR = baseRadius + sunPulse; const endR = w * 0.09 + pulseLen; 
				const normalAngle = angle + Math.PI/2; const midWidth = w * 0.002; const midR = (startR + endR) / 2;
				const midX = sunX + Math.cos(angle) * midR; const midY = sunY + Math.sin(angle) * midR;
				const glintGrad = ctx.createLinearGradient(sunX + Math.cos(angle) * startR, sunY + Math.sin(angle) * startR, sunX + Math.cos(angle) * endR, sunY + Math.sin(angle) * endR);
				glintGrad.addColorStop(0, `rgba(255, 255, 255, ${flicker})`); glintGrad.addColorStop(0.3, `rgba(255, 242, 0, ${flicker})`); glintGrad.addColorStop(1, `rgba(255, 242, 0, 0)`); 
				ctx.fillStyle = glintGrad; ctx.beginPath();
				ctx.moveTo(sunX + Math.cos(angle) * startR, sunY + Math.sin(angle) * startR); ctx.lineTo(midX + Math.cos(normalAngle) * midWidth, midY + Math.sin(normalAngle) * midWidth);
				ctx.lineTo(sunX + Math.cos(angle) * endR, sunY + Math.sin(angle) * endR); ctx.lineTo(midX - Math.cos(normalAngle) * midWidth, midY - Math.sin(normalAngle) * midWidth);
				ctx.closePath(); ctx.fill();
			}
			ctx.restore(); ctx.restore(); 
		}

		// D. Fade in the Plane
		if (!this.bgState.nagoyaPlane) {
			this.bgState.nagoyaPlane = { x: -w * 0.1, y: h * (0.05 + Math.random() * 0.15), angle: (Math.random() - 0.5) * (Math.PI / 18), speed: w * 0.0000025, history: [], lastPointTime: 0, maxHistoryTime: 50000 };
		}
		const plane = this.bgState.nagoyaPlane;
		plane.x += Math.cos(plane.angle) * plane.speed * dt; plane.y += Math.sin(plane.angle) * plane.speed * dt;
		if (plane.x > w * 1.15) { plane.x = -w * 0.15; plane.y = h * (0.05 + Math.random() * 0.15); plane.angle = (Math.random() - 0.5) * (Math.PI / 18); plane.history = []; }
		if (this.elapsed > 0 && (!plane.lastPointTime || this.elapsed - plane.lastPointTime > 150)) { plane.history.push({ x: plane.x, y: plane.y, time: this.elapsed }); plane.lastPointTime = this.elapsed; }
		while (plane.history.length > 0 && this.elapsed - plane.history[0].time > plane.maxHistoryTime) { plane.history.shift(); }

		ctx.save();
		ctx.globalAlpha = Math.max(0, Math.min(1, (t - 800) / 400)); 
		if (plane.history.length > 1) {
			for (let i = 1; i < plane.history.length; i++) {
				const p1 = plane.history[i-1]; const p2 = plane.history[i]; const lifePhase = Math.min(1, (this.elapsed - p2.time) / plane.maxHistoryTime);
				ctx.strokeStyle = `rgba(230, 230, 230, ${Math.max(0, 0.35 * Math.pow(1 - lifePhase, 1.5))})`;
				ctx.lineWidth = w * 0.0004 + (lifePhase * w * 0.003); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
			}
		}
		if (plane.x > -w*0.05 && plane.x < w*1.05) {
			ctx.save(); ctx.translate(plane.x, plane.y); ctx.rotate(plane.angle); ctx.fillStyle = 'rgba(30, 20, 10, 0.7)'; 
			ctx.fillRect(-(w * 0.007)/2, -(w * 0.0007)/2, w * 0.007, w * 0.0007); ctx.fillRect(-(w * 0.007)/2, -(w * 0.0015), w * 0.001, w * 0.0015); ctx.fillRect(-(w * 0.007)*0.1, 0, (w * 0.007)*0.25, (w * 0.0007)*0.8);
			ctx.restore();
		}
		ctx.restore();

		// E. EASTER EGG: RYAN & NEWT (THE SHORELINE WATCHERS)
		if (this.bgState.showEasterEgg) {
			const easterEggScale = this.getPopScale(t, 600, 800); 
			if (easterEggScale > 0) {
				ctx.save();
				
				const rnX = w * 0.78; 
				const tRN = rnX / w;
				const rnGroundY = Math.pow(1-tRN, 2)*(h*0.7) + 2*(1-tRN)*tRN*(h*0.85) + Math.pow(tRN, 2)*(h*0.75);
				const rnY = rnGroundY + h * 0.04; 

				const sway = Math.sin(this.elapsed * 0.001) * 0.04;
				const breath = Math.sin(this.elapsed * 0.0015) * h * 0.0005;

				ctx.translate(rnX, rnY);
				ctx.scale(easterEggScale * 0.9, easterEggScale * 0.9); 

				const u = w * 0.001; 
				const v = h * 0.001;
				const silhouetteCol = '#1a100c';

				// 1. Ryan (Sitting person, refined outline)
				ctx.save();
				ctx.translate(-u * 6, breath);
				ctx.rotate(sway * 0.5);

				// Base torso & legs (sitting curves)
				ctx.fillStyle = silhouetteCol;
				ctx.beginPath();
				ctx.moveTo(-u * 6, 0); // seat base
				ctx.bezierCurveTo(-u * 10, -v * 15, -u * 6, -v * 20, -u * 2, -v * 22); // back curve up
				ctx.lineTo(u * 2, -v * 22); // shoulder width
				ctx.bezierCurveTo(u * 6, -v * 20, u * 10, -v * 15, u * 12, 0); // front down curve (resting hands)
				ctx.fill();

				// Head silhouette (precise outline)
				ctx.beginPath();
				ctx.arc(0, -v * 28, u * 4.8, 0, Math.PI * 2);
				ctx.fill();

				// Red and White Ball Cap (sitting precise)
				ctx.fillStyle = '#ffffff'; // White dome
				ctx.beginPath();
				ctx.arc(0, -v * 28.5, u * 4.9, Math.PI * 0.8, Math.PI * 1.5);
				ctx.fill();

				ctx.fillStyle = '#e74c3c'; // Red back
				ctx.beginPath();
				ctx.arc(0, -v * 28.5, u * 5.0, -Math.PI * 0.5, Math.PI * 0.8);
				ctx.lineTo(0, -v * 28.5);
				ctx.fill();

				// Sharp forward Brim (Facing Left)
				ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = v * 1.2; ctx.lineCap = 'round';
				ctx.beginPath();
				ctx.moveTo(-u * 3.5, -v * 29);
				ctx.lineTo(-u * 9, -v * 28);
				ctx.stroke();

				ctx.restore();

				// 2. Newt (Back-view Hound Silhouette precisely matching the uploaded image)
				ctx.save();
				ctx.translate(u * 10, breath * 1.2);
				ctx.fillStyle = silhouetteCol;

				// Base Body silhouette (Sitting from the back)
				ctx.beginPath();
				ctx.moveTo(-u * 3.5, 0); // left bottom
				// Left hip and haunch
				ctx.bezierCurveTo(-u * 9, 0, -u * 9.5, -v * 8, -u * 5.5, -v * 12);
				// Left waist up to shoulder
				ctx.bezierCurveTo(-u * 4.5, -v * 14, -u * 5.5, -v * 17, -u * 3, -v * 19);
				// Left slender neck
				ctx.lineTo(-u * 2.5, -v * 21);
				
				// Head dome
				ctx.arc(0, -v * 22, u * 3.5, Math.PI, 0); 
				
				// Right slender neck
				ctx.lineTo(u * 2.5, -v * 21);
				// Right shoulder down to waist
				ctx.bezierCurveTo(u * 5.5, -v * 17, u * 4.5, -v * 14, u * 5.5, -v * 12);
				// Right hip and haunch
				ctx.bezierCurveTo(u * 9.5, -v * 8, u * 9, 0, u * 3.5, 0);
				
				// Bottom paws (scalloped bottom edge to represent resting feet)
				ctx.bezierCurveTo(u * 2, -v * 1.5, u * 1, -v * 1.5, 0, 0);
				ctx.bezierCurveTo(-u * 1, -v * 1.5, -u * 2, -v * 1.5, -u * 3.5, 0);
				ctx.fill();

				// Floppy, drooping ears on the sides of the head
				ctx.beginPath();
				ctx.ellipse(-u * 3.8, -v * 21, u * 1.6, v * 3.5, Math.PI * 0.1, 0, Math.PI * 2); // Left ear
				ctx.fill();
				ctx.beginPath();
				ctx.ellipse(u * 3.8, -v * 21, u * 1.6, v * 3.5, -Math.PI * 0.1, 0, Math.PI * 2); // Right ear
				ctx.fill();

				// Elegant curved tail extending to the right
				ctx.beginPath();
				ctx.moveTo(u * 6.5, -v * 4); // Tail base on the right hip
				ctx.bezierCurveTo(u * 10, -v * 4, u * 12, -v * 9, u * 11, -v * 12); // Outer curve up
				ctx.bezierCurveTo(u * 10, -v * 10, u * 8, -v * 7, u * 5.5, -v * 6.5); // Inner curve back to body
				ctx.fill();

				ctx.restore();
				ctx.restore();
			}
		}

		// F. Pop the Umbrellas
		if (this.bgState.nagoyaUmbrellas) {
			this.bgState.nagoyaUmbrellas.forEach(u => {
				const uScale = this.getPopScale(t, u.popDelay, 600);
				if (uScale === 0) return;

				ctx.save();
				ctx.translate(u.ux, u.uy); ctx.scale(uScale, uScale); ctx.rotate(u.tilt);

				const size = u.size; const c = u.color;
				ctx.fillStyle = '#333'; ctx.fillRect(-w*0.001, size*0.05, w*0.002, h*0.035);
				ctx.fillStyle = c.base; ctx.beginPath(); ctx.moveTo(-size, 0); ctx.quadraticCurveTo(0, -size * 1.3, size, 0);
				for (let i = 4; i > 0; i--) { const stepW = (size * 2) / 4; const endX = -size + (i * stepW); ctx.bezierCurveTo((endX + stepW) - stepW*0.3, size * 0.08, endX + stepW*0.3, size * 0.08, endX, 0); }
				ctx.fill();
				ctx.strokeStyle = c.rib; ctx.lineWidth = w*0.001;
				for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, -size * 0.15); ctx.lineTo(-size + (i * ((size * 2) / 4)), 0); ctx.stroke(); }
				ctx.fillStyle = c.cap; ctx.beginPath(); ctx.moveTo(-w*0.003, -size * 0.15); ctx.quadraticCurveTo(0, (-size * 0.15) - size*0.1, w*0.003, -size * 0.15); ctx.lineTo(w*0.002, (-size * 0.15) + w*0.002); ctx.lineTo(-w*0.002, (-size * 0.15) + w*0.002); ctx.fill();
				ctx.restore();
			});
		}

		ctx.restore(); 
	},

	drawFukuoka: function(dt) {
		const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height;
		const horizon = h * 0.82; 
		
		// 👇 NEW: Cap 'dt' and track the intro timer
		const safeDt = Math.min(dt, 32);
		this.bgState.introTimer = (this.bgState.introTimer || 0) + safeDt;
		const t = this.bgState.introTimer;

		// --- 1. CACHE STATIC ELEMENTS & GENERATE DYNAMIC LIGHTS ---
		// Notice we check for fukuokaRoadCache to ensure the split cache rebuilds if needed
		if (!this.bgState.fukuokaSkyCache || this.bgState.fukuokaSkyCache.width !== w || this.bgState.fukuokaSkyCache.height !== h || !this.bgState.fukuokaRoadCache) {
			
			// A. SKY CACHE
			this.bgState.fukuokaSkyCache = document.createElement('canvas');
			this.bgState.fukuokaSkyCache.width = w; this.bgState.fukuokaSkyCache.height = h;
			const skyCtx = this.bgState.fukuokaSkyCache.getContext('2d');

			let grad = skyCtx.createLinearGradient(0, 0, 0, horizon);
			grad.addColorStop(0, '#060f22');   
			grad.addColorStop(0.5, '#122a46');  
			grad.addColorStop(1, '#1d4659');    
			skyCtx.fillStyle = grad; 
			skyCtx.fillRect(0, 0, w, h);

			skyCtx.fillStyle = '#ffffff';
			for (let i = 0; i < 150; i++) {
				let sx = Math.random() * w; let sy = Math.random() * horizon; let sSize = Math.random() * 1.5;
				skyCtx.globalAlpha = 0.1 + Math.random() * 0.7;
				skyCtx.beginPath(); skyCtx.arc(sx, sy, sSize, 0, Math.PI * 2); skyCtx.fill();
			}
			skyCtx.globalAlpha = 1.0;

			const moonX = w * 0.65; const moonY = h * 0.18;
			skyCtx.shadowBlur = 40; skyCtx.shadowColor = '#e6d0ce'; skyCtx.fillStyle = '#f2e8e7';
			skyCtx.beginPath(); skyCtx.arc(moonX, moonY, w * 0.025, 0, Math.PI * 2); skyCtx.fill();
			skyCtx.shadowBlur = 0; 

			// B. CITY CACHE & DYNAMIC LIGHTS INITIALIZATION
			this.bgState.fukuokaCityCache = document.createElement('canvas');
			this.bgState.fukuokaCityCache.width = w; this.bgState.fukuokaCityCache.height = h;
			const cityCtx = this.bgState.fukuokaCityCache.getContext('2d');
			
			this.bgState.fukuokaLights = []; 
			this.bgState.dynamicCityLights = []; 
			const billboardBounds = []; 

			const sumoPhrases = [
				{ txt: "残った", isV: true }, { txt: "横綱", isV: true }, { txt: "大相撲", isV: false }, 
				{ txt: "満員御礼", isV: true }, { txt: "寄り切り", isV: false }, { txt: "土俵", isV: false }     
			];

			const applyAuthenticWindows = (ctx, bx, by, bw, bh, baseCol, depthFactor, isForeground) => {
				const textureType = Math.floor(Math.random() * 4); 
				const darkColor = `rgba(0, 0, 0, ${depthFactor * 0.6})`;
				
				ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
				if (textureType === 0) {
					const rows = 12 + Math.floor(Math.random() * 10); const cols = 5 + Math.floor(Math.random() * 4);
					const rH = bh / rows; const cW = bw / cols;
					for(let r = 0; r < rows; r++) {
						for(let c = 0; c < cols; c++) {
							let vOp = 0.2 + Math.random() * 0.4;
							let wx = bx + c*cW + 1; let wy = by + r*rH + 1; let ww = cW - 2; let wh = rH - 2;
							ctx.fillStyle = (Math.random() > 0.05) ? `rgba(10, 20, 30, ${vOp})` : baseCol;
							ctx.fillRect(wx, wy, ww, wh);
							if (isForeground && Math.random() > 0.95) {
								this.bgState.dynamicCityLights.push({
									type: 'window', x: wx, y: wy, w: ww, h: wh,
									color: (Math.random() > 0.5) ? 'rgba(255, 255, 200, 0.85)' : 'rgba(200, 240, 255, 0.85)',
									offColor: `rgba(10, 20, 30, ${vOp})`, on: Math.random() > 0.5, timer: Math.random() * 2000,
									interval: 2000 + Math.random() * 8000
								});
							} else if(Math.random() > 0.96) {
								ctx.fillStyle = `rgba(255, 255, 200, 0.7)`; ctx.fillRect(wx, wy, ww, wh);
							}
						}
					}
				} else if (textureType === 1 || textureType === 3) {
					ctx.fillStyle = `rgba(0, 0, 0, ${depthFactor * 0.4})`; ctx.fillRect(bx, by, bw, bh);
					const windowH = textureType === 1 ? h * 0.01 : 4; const windowW = textureType === 1 ? h * 0.007 : 3;
					const spacingY = textureType === 1 ? h * 0.015 : 10; const spacingX = textureType === 1 ? w * 0.01 : 7.5;
					ctx.fillStyle = darkColor;
					for (let wx = bx + windowW; wx < bx + bw - windowW; wx += spacingX) {
						for (let wy = by + windowH; wy < horizon - windowH; wy += spacingY) {
							if (wy < by + bh - windowH) {
								ctx.fillRect(wx, wy, windowW, windowH);
								if (isForeground && Math.random() > 0.97) {
									this.bgState.dynamicCityLights.push({
										type: 'window', x: wx, y: wy, w: windowW, h: windowH,
										color: 'rgba(255, 240, 200, 0.9)', offColor: darkColor,
										on: Math.random() > 0.5, timer: Math.random() * 2000, interval: 3000 + Math.random() * 5000
									});
								}
							}
						}
					}
				} else if (textureType === 2) {
					const bandCount = 8 + Math.floor(Math.random() * 5); const bandH = bh / bandCount;
					ctx.fillStyle = darkColor;
					for(let i = 0; i < bandCount; i += 2) ctx.fillRect(bx, by + (i+1)*bandH, bw, bandH * 0.6);
				}
				ctx.restore();
			};

			const drawAuthenticCityscape = (bg, blockCount, heightMultiplier, baseColor) => {
				const depthFactor = bg ? 1.0 : 0.0;
				for(let i = 0; i < blockCount; i++) {
					let bx = Math.random() * w; let bw = w * 0.02 + Math.random() * w * 0.04;
					let bh = h * 0.05 + Math.random() * h * heightMultiplier; let by = horizon - bh;
					let roofType = Math.floor(Math.random() * 4); let roofH = 0;
					
					cityCtx.fillStyle = baseColor;
					if (Math.random() > 0.5) { 
						const sideW = bw * 0.2; const depthCol = (bg) ? '#08101a' : '#0e1625';
						cityCtx.fillStyle = depthCol; cityCtx.beginPath();
						if (bx < w/2) {
							cityCtx.moveTo(bx, by); cityCtx.lineTo(bx - sideW, by - sideW*0.5);
							cityCtx.lineTo(bx - sideW, by + bh - sideW*0.5); cityCtx.lineTo(bx, by + bh);
						} else {
							cityCtx.moveTo(bx + bw, by); cityCtx.lineTo(bx + bw + sideW, by - sideW*0.5);
							cityCtx.lineTo(bx + bw + sideW, by + bh - sideW*0.5); cityCtx.lineTo(bx + bw, by + bh);
						}
						cityCtx.fill();
					}
					cityCtx.fillStyle = baseColor; cityCtx.fillRect(bx, by, bw, bh);
					
					if (roofType === 1) { 
						let tierW = bw * 0.6; roofH = bh * 0.1; cityCtx.fillRect(bx + (bw - tierW)/2, by - roofH, tierW, roofH);
					} else if (roofType === 2) { 
						roofH = bh * 0.15; cityCtx.beginPath(); cityCtx.moveTo(bx, by); cityCtx.lineTo(bx + bw, by); cityCtx.lineTo(bx + bw/2, by - roofH); cityCtx.fill();
					} else if (roofType === 3) { 
						roofH = bh * 0.2; cityCtx.fillRect(bx + bw/2 - 1, by - roofH, 2, roofH);
					}
					
					if ((bh + roofH) > (h * 0.25) && Math.random() > 0.3) {
						this.bgState.dynamicCityLights.push({
							type: 'beacon', x: bx + bw/2, y: by - roofH - 2, on: false, timer: Math.random() * 2000, interval: 1500
						});
					}
					if(!bg || Math.random() > 0.4) applyAuthenticWindows(cityCtx, bx, by, bw, bh, baseColor, depthFactor, !bg);

					if (!bg && bh > h * 0.2 && Math.random() > 0.75) {
						const phraseData = sumoPhrases[Math.floor(Math.random() * sumoPhrases.length)];
						let neonW, neonH, neonX, neonY, fontSize;

						if (phraseData.isV) {
							neonW = bw * 0.25; neonH = bh * 0.7; neonX = (Math.random() > 0.5 ? bx + bw * 0.1 : bx + bw * 0.65);
							neonY = by + bh * 0.15; fontSize = Math.floor(neonW * 0.85); 
						} else {
							neonW = bw * 0.8; neonH = bh * 0.25; neonX = bx + bw * 0.1;
							neonY = by + bh * 0.2 + Math.random() * (bh * 0.4); fontSize = Math.floor(neonH * 0.7); 
						}

						let isOverlapping = false;
						const buffer = 15;
						for (let b of billboardBounds) {
							if (neonX < b.x + b.w + buffer && neonX + neonW > b.x - buffer && 
								neonY < b.y + b.h + buffer && neonY + neonH > b.y - buffer) {
								isOverlapping = true; break;
							}
						}

						if (!isOverlapping) {
							billboardBounds.push({ x: neonX, y: neonY, w: neonW, h: neonH });
							cityCtx.fillStyle = '#050a12'; cityCtx.strokeStyle = '#1a2538'; cityCtx.lineWidth = 1.5;
							cityCtx.fillRect(neonX - 2, neonY - 2, neonW + 4, neonH + 4);
							cityCtx.strokeRect(neonX - 2, neonY - 2, neonW + 4, neonH + 4);
							cityCtx.beginPath();
							cityCtx.moveTo(neonX, neonY + neonH*0.2); cityCtx.lineTo(bx + bw/2, neonY + neonH*0.2);
							cityCtx.moveTo(neonX, neonY + neonH*0.8); cityCtx.lineTo(bx + bw/2, neonY + neonH*0.8);
							cityCtx.stroke();

							const hues = [190, 320, 45, 210]; const neonHue = hues[Math.floor(Math.random() * hues.length)];
							this.bgState.dynamicCityLights.push({
								type: 'neonKanji', x: neonX, y: neonY, w: neonW, h: neonH, text: phraseData.txt,
								fontSize: fontSize, isVertical: phraseData.isV, baseHue: neonHue,
								timer: Math.random() * 3000, charIndex: 0, typeSpeed: 150 + Math.random() * 250, 
								holdTimer: Math.random() * 1000, holdTime: 2500 + Math.random() * 4000, state: 'typing' 
							});
							this.bgState.fukuokaLights.push({ x: neonX + neonW/2, w: neonW * 2, color: `hsl(${neonHue}, 100%, 70%)`, intensity: 0.5 });
						}
					}
				}
			};

			drawAuthenticCityscape(true, 40, 0.25, '#0a1220'); drawAuthenticCityscape(false, 30, 0.2, '#111d30'); 

			const portX = w * 0.2; cityCtx.fillStyle = '#080d18'; cityCtx.strokeStyle = '#00f3ff'; cityCtx.lineWidth = 1.5;
			for (let i = 0; i < 3; i++) {
				const cX = portX - w*0.1 - i*w*0.04;
				cityCtx.beginPath(); cityCtx.moveTo(cX - w*0.01, horizon); cityCtx.lineTo(cX, horizon - h*0.12); cityCtx.lineTo(cX + w*0.01, horizon); cityCtx.fill();
				cityCtx.fillRect(cX - w*0.02, horizon - h*0.12, w*0.04, h*0.01); 
				this.bgState.dynamicCityLights.push({ type: 'beacon', x: cX, y: horizon - h*0.12 - 2, on: false, timer: Math.random()*1000, interval: 1000 });
			}
			cityCtx.beginPath(); cityCtx.moveTo(portX, horizon); cityCtx.lineTo(portX + w*0.015, horizon - h*0.25); cityCtx.lineTo(portX + w*0.025, horizon - h*0.25); cityCtx.lineTo(portX + w*0.04, horizon); cityCtx.fill();
			cityCtx.save(); cityCtx.beginPath(); cityCtx.moveTo(portX, horizon); cityCtx.lineTo(portX + w*0.02, horizon - h*0.25); cityCtx.lineTo(portX + w*0.04, horizon); cityCtx.clip();
			cityCtx.lineWidth = 1.0;
			for (let ly = horizon; ly > horizon - h*0.25; ly -= h*0.04) { cityCtx.beginPath(); cityCtx.moveTo(portX, ly); cityCtx.lineTo(portX + w*0.04, ly); cityCtx.stroke(); }
			cityCtx.restore();

			const fX = w * 0.78; const fW = w * 0.035; const fH = h * 0.45; const fTop = horizon - fH;
			cityCtx.fillStyle = '#0d1828'; cityCtx.fillRect(fX - fW/2, fTop + h*0.1, fW, fH - h*0.1);
			cityCtx.save(); cityCtx.beginPath(); cityCtx.rect(fX - fW/2, fTop + h*0.1, fW, fH - h*0.1); cityCtx.clip();
			cityCtx.fillStyle = 'rgba(20, 30, 40, 0.4)'; cityCtx.strokeStyle = 'rgba(50, 70, 90, 0.2)';
			for (let fx = fX - fW/2; fx < fX + fW/2; fx += fW/4) { for (let fy = fTop + h*0.1; fy < horizon; fy += h*0.01) { cityCtx.strokeRect(fx, fy, fW/4, h*0.01); } }
			cityCtx.restore();
			cityCtx.fillStyle = '#0d1828'; cityCtx.beginPath(); cityCtx.moveTo(fX - fW/2, fTop + h*0.1); cityCtx.lineTo(fX, fTop); cityCtx.lineTo(fX + fW/2, fTop + h*0.1); ctx.closePath(); cityCtx.fill();
			this.bgState.dynamicCityLights.push({ type: 'towerPulse', x: fX - 1, y: fTop + h*0.1, w: 2, h: fH - h*0.1, baseHue: 185, timer: Math.random() * 1000 });
			this.bgState.fukuokaLights.push({ x: fX, w: fW*2, color: '#00f3ff', intensity: 0.8 });
			this.bgState.fukuokaLights.push({ x: moonX, w: w*0.1, color: '#e6d0ce', intensity: 0.5 }); 

			// 👇 NEW: C. ISOLATED ROAD CACHE (Allows independent sliding animation)
			this.bgState.fukuokaRoadCache = document.createElement('canvas');
			this.bgState.fukuokaRoadCache.width = w; this.bgState.fukuokaRoadCache.height = h;
			const roadCtx = this.bgState.fukuokaRoadCache.getContext('2d');

			let roadH = h - horizon;
			let roadGrad = roadCtx.createLinearGradient(0, horizon, 0, h);
			roadGrad.addColorStop(0, '#0a1018'); roadGrad.addColorStop(0.5, '#121a24'); roadGrad.addColorStop(1, '#080d14');
			roadCtx.fillStyle = roadGrad;
			roadCtx.fillRect(0, horizon, w, roadH);

			roadCtx.fillStyle = '#1c2633'; roadCtx.fillRect(0, horizon + roadH * 0.48, w, roadH * 0.04);
			roadCtx.fillStyle = '#0f1620'; roadCtx.fillRect(0, horizon + roadH * 0.52, w, roadH * 0.02);

			roadCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; roadCtx.lineWidth = 1.5;
			roadCtx.setLineDash([w * 0.03, w * 0.03]);
			roadCtx.beginPath(); roadCtx.moveTo(0, horizon + roadH * 0.16); roadCtx.lineTo(w, horizon + roadH * 0.16); roadCtx.stroke();
			roadCtx.beginPath(); roadCtx.moveTo(0, horizon + roadH * 0.32); roadCtx.lineTo(w, horizon + roadH * 0.32); roadCtx.stroke();
			roadCtx.beginPath(); roadCtx.moveTo(0, horizon + roadH * 0.68); roadCtx.lineTo(w, horizon + roadH * 0.68); roadCtx.stroke();
			roadCtx.beginPath(); roadCtx.moveTo(0, horizon + roadH * 0.84); roadCtx.lineTo(w, horizon + roadH * 0.84); roadCtx.stroke();
			roadCtx.setLineDash([]); 

			const crossX = w * 0.35; const crossW = w * 0.08;
			roadCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
			for (let y = horizon + roadH * 0.05; y < h - roadH * 0.05; y += roadH * 0.08) {
				if (y > horizon + roadH * 0.45 && y < horizon + roadH * 0.55) continue;
				roadCtx.fillRect(crossX, y, crossW, roadH * 0.04);
			}

			// D. PARTICLE EFFECTS CACHE
			this.bgState.cloudCache = document.createElement('canvas'); this.bgState.cloudCache.width = 128; this.bgState.cloudCache.height = 128;
			let cGrad = this.bgState.cloudCache.getContext('2d'); let cg = cGrad.createRadialGradient(64, 64, 0, 64, 64, 64);
			cg.addColorStop(0, `rgba(200, 220, 240, 0.8)`); cg.addColorStop(0.5, `rgba(180, 200, 230, 0.3)`); cg.addColorStop(1, 'rgba(200, 220, 240, 0)');
			cGrad.fillStyle = cg; cGrad.fillRect(0,0,128,128);

			this.bgState.mistCache = document.createElement('canvas'); this.bgState.mistCache.width = 128; this.bgState.mistCache.height = 128;
			let mGrad = this.bgState.mistCache.getContext('2d'); let mg = mGrad.createRadialGradient(64, 64, 0, 64, 64, 64);
			mg.addColorStop(0, `rgba(170, 190, 210, 0.6)`); mg.addColorStop(1, 'rgba(170, 190, 210, 0)');
			mGrad.fillStyle = mg; mGrad.fillRect(0,0,128,128);

			const makeLight = (core, glow) => {
				const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
				x.shadowBlur = 15; x.shadowColor = glow; x.fillStyle = core; x.beginPath(); x.arc(32, 32, 8, 0, Math.PI * 2); x.fill(); return c;
			};
			this.bgState.headlightCache = makeLight('#fffee0', '#ffffff');
			this.bgState.taillightCache = makeLight('#ff1500', '#ff0000');
		}

		// --- 2. UPDATE LOGIC ---
		this.bgState.clouds.forEach(c => { c.x -= c.vx * (dt / 1000); if (c.x + c.w * 2 < 0) c.x = w + c.w * 2; });
		this.bgState.mist.forEach(m => { m.x += m.vx * (dt / 1000); if (m.x - m.r * 2 > w) m.x = -m.r * 2; });

		this.bgState.dynamicCityLights.forEach(light => {
			if (light.type === 'neonKanji') {
				if (light.state === 'typing') {
					light.timer += dt; light.charIndex = Math.floor(light.timer / light.typeSpeed);
					if (light.charIndex >= light.text.length) { light.charIndex = light.text.length; light.state = 'holding'; light.holdTimer = 0; }
				} else if (light.state === 'holding') { light.holdTimer += dt; if (light.holdTimer > light.holdTime) { light.state = 'flash'; light.holdTimer = 0; }
				} else if (light.state === 'flash') { light.holdTimer += dt; if (light.holdTimer > 500) { light.state = 'typing'; light.timer = 0; light.charIndex = 0; } }
			}
			else if (light.type === 'beacon') { light.timer += dt; if (light.timer > light.interval) { light.timer = 0; light.on = !light.on; light.interval = light.on ? 200 : 1800 + Math.random() * 1000; } } 
			else if (light.type === 'window') { light.timer += dt; if (light.timer > light.interval) { light.timer = 0; light.on = !light.on; light.interval = 3000 + Math.random() * 10000; } }
			else if (light.type === 'towerPulse') { light.timer += dt; }
		});

		// Initialize & Update Traffic Logic
		if (!this.bgState.traffic || this.bgState.traffic.length === 0 || this.bgState.traffic[0].popDelay === undefined) {
			this.bgState.traffic = [];
			const vehicleTypes = ['sedan', 'truck', 'coupe'];

			for (let i = 0; i < 50; i++) {
				const directionIsLeft = Math.random() > 0.5; 
				const laneIdx = Math.floor(Math.random() * 3); 
				const roadH = h - horizon;
				const laneY = directionIsLeft ? horizon + roadH * 0.08 + (laneIdx * roadH * 0.16) : horizon + roadH * 0.60 + (laneIdx * roadH * 0.16);
				const baseSpeed = w * 0.05 + Math.random() * w * 0.07;
				
				this.bgState.traffic.push({
					x: Math.random() * w, y: laneY, type: vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)],
					baseSpeed: baseSpeed, speed: (directionIsLeft ? -1 : 1) * baseSpeed, targetSpeed: (directionIsLeft ? -1 : 1) * baseSpeed,
					directionIsLeft: directionIsLeft, laneIdx: laneIdx, behaviorTimer: Math.random() * 2000, isBraking: false, state: 'normal',
					chassisColor: Math.random() > 0.8 ? `hsl(${Math.random()*360}, 40%, 15%)` : '#0d1117',
					popDelay: 800 + Math.random() * 1500 // 👇 NEW: Stagger traffic spawning
				});
			}
		}

		const easeOutCirc = (x) => Math.sqrt(1 - (x - 1) * (x - 1));

		this.bgState.traffic.forEach((car, index, arr) => {
			car.behaviorTimer -= dt; car.isBraking = false; 

			let carInFront = null; let minDistance = w; 
			for (let otherCar of arr) {
				if (otherCar === car || otherCar.directionIsLeft !== car.directionIsLeft || otherCar.laneIdx !== car.laneIdx) continue;
				let dist = car.directionIsLeft ? (car.x - otherCar.x) : (otherCar.x - car.x);
				if (dist < 0) dist += w;
				if (dist > 0 && dist < minDistance) { minDistance = dist; carInFront = otherCar; }
			}

			const safeGap = w * 0.08; 
			if (carInFront) {
				if (minDistance < safeGap * 0.6) { car.targetSpeed = carInFront.speed * 0.5; car.isBraking = true;
				} else if (minDistance < safeGap) { car.targetSpeed = carInFront.speed; car.isBraking = car.speed > carInFront.speed + (w*0.01);
				} else if (car.behaviorTimer <= 0) { car.behaviorTimer = 2000 + Math.random() * 4000; car.targetSpeed = (car.directionIsLeft ? -1 : 1) * car.baseSpeed * (0.6 + Math.random() * 0.6); car.isBraking = Math.abs(car.targetSpeed) < Math.abs(car.speed) - (w * 0.01); }
			}

			const crosswalkStopX = w * 0.35 + (w * 0.08 / 2); const isCrosswalkRed = ((Date.now() / 1000) % 20) > 14; 
			if (isCrosswalkRed) {
				let distToStop = car.directionIsLeft ? (car.x - crosswalkStopX) : (crosswalkStopX - car.x);
				if (distToStop < 0) distToStop += w; 
				if (distToStop > w*0.01 && distToStop < w * 0.15) {
					const approachEase = easeOutCirc(distToStop / (w * 0.15)); 
					car.targetSpeed = (car.directionIsLeft ? -1 : 1) * car.baseSpeed * approachEase; car.isBraking = true;
					if (approachEase < 0.1) { car.speed = 0; car.targetSpeed = 0; }
				}
			}

			car.speed += (car.targetSpeed - car.speed) * (dt / 1000) * 1.5; 
			if (car.speed < car.targetSpeed + (w*0.005) && (car.speed * car.targetSpeed > 0)) { car.isBraking = true; }

			car.x += car.speed * (dt / 1000);
			if (car.speed > 0 && car.x > w + 50) car.x = -50;
			if (car.speed < 0 && car.x < -50) car.x = w + 50;
		});

		// --- 3. RENDERING PHASE ---
		ctx.globalAlpha = Math.min(1, t / 400); // Sky fade in
		ctx.drawImage(this.bgState.fukuokaSkyCache, 0, 0);

		ctx.globalAlpha = 1.0;
		this.bgState.clouds.forEach(c => {
			ctx.globalAlpha = c.op; 
			ctx.drawImage(this.bgState.cloudCache, c.x - c.w * 2.5, c.y - c.w * 0.4, c.w * 5, c.w * 0.8);
		});
		ctx.globalAlpha = 1.0;

		// 👇 NEW: Sliced "Piano Key" cascade for the baked City Cache!
		const sliceCount = 40;
		const sliceW = Math.ceil(w / sliceCount);
		for (let i = 0; i < sliceCount; i++) {
			const sliceX = i * sliceW;
			const slicePopDelay = (i / sliceCount) * 600; 
			const sliceScale = this.getPopScale(t, slicePopDelay, 600);
			
			if (sliceScale > 0) {
				ctx.save();
				ctx.translate(sliceX + sliceW/2, horizon);
				ctx.scale(1, Math.max(0.001, sliceScale));
				ctx.translate(-(sliceX + sliceW/2), -horizon);
				ctx.drawImage(this.bgState.fukuokaCityCache, sliceX, 0, sliceW, horizon, sliceX, 0, sliceW, horizon);
				ctx.restore();
			}
		}

		// 👇 NEW: Sliding Road Cache Animation!
		const roadSlideProgress = Math.min(1, t / 800);
		if (roadSlideProgress > 0) {
			const slideOffset = (1 - roadSlideProgress) * (h - horizon);
			ctx.save();
			ctx.translate(0, slideOffset);
			ctx.drawImage(this.bgState.fukuokaRoadCache, 0, 0);
			ctx.restore();
		}

		ctx.save();
		ctx.globalCompositeOperation = 'screen'; 
		
		// BATCH 1: Lit Windows
		for(let light of this.bgState.dynamicCityLights) {
			if (light.type === 'window' && light.on) {
				const lScale = this.getPopScale(t, (light.x / w) * 600, 600);
				if (lScale === 0) continue;
				ctx.save(); ctx.translate(light.x, horizon); ctx.scale(1, lScale); ctx.translate(-light.x, -horizon);
				ctx.fillStyle = light.color; ctx.fillRect(light.x, light.y, light.w, light.h);
				ctx.restore();
			}
		}

		// BATCH 2: Beacons 
		ctx.fillStyle = '#ff003c';
		for(let light of this.bgState.dynamicCityLights) {
			if (light.type === 'beacon' && light.on) {
				const lScale = this.getPopScale(t, (light.x / w) * 600, 600);
				if (lScale === 0) continue;
				ctx.save(); ctx.translate(light.x, horizon); ctx.scale(1, lScale); ctx.translate(-light.x, -horizon);
				ctx.beginPath(); ctx.arc(light.x, light.y, 2, 0, Math.PI*2); ctx.fill();
				ctx.restore();
			}
		}

		// BATCH 3: Tower Pulse
		for(let light of this.bgState.dynamicCityLights) {
			if (light.type === 'towerPulse') {
				const lScale = this.getPopScale(t, (light.x / w) * 600, 600);
				if (lScale === 0) continue;
				ctx.save(); ctx.translate(light.x, horizon); ctx.scale(1, lScale); ctx.translate(-light.x, -horizon);
				const alpha = 0.3 + (Math.sin(light.timer / 800) * 0.3); 
				ctx.fillStyle = `hsl(${light.baseHue}, 100%, 70%)`; ctx.globalAlpha = alpha; 
				ctx.fillRect(light.x, light.y, light.w, light.h); 
				ctx.restore();
			}
		}
		ctx.globalAlpha = 1.0;

		// BATCH 4: Neon Kanji
		for(let light of this.bgState.dynamicCityLights) {
			if (light.type === 'neonKanji') {
				const lScale = this.getPopScale(t, (light.x / w) * 600, 600);
				if (lScale === 0) continue;

				const textToShow = light.text.substring(0, light.charIndex);
				if (textToShow.length === 0 && light.state !== 'flash') continue;

				ctx.save();
				ctx.translate(light.x + light.w/2, horizon); ctx.scale(1, lScale); ctx.translate(-(light.x + light.w/2), -horizon);

				const isFlashingOff = (light.state === 'flash' && light.holdTimer > 100 && light.holdTimer < 250) || (light.state === 'flash' && light.holdTimer > 350);
				ctx.font = `bold ${light.fontSize}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
				const chars = light.isVertical ? textToShow.split('') : null;
				const charStep = light.isVertical ? light.h / light.text.length : 0;
				const startY = light.isVertical ? light.y + charStep / 2 : 0;

				if (!isFlashingOff) {
					ctx.lineWidth = light.fontSize * 0.15; ctx.strokeStyle = `hsl(${light.baseHue}, 100%, 40%)`; ctx.globalAlpha = 0.4;
					if (light.isVertical) { chars.forEach((char, index) => { ctx.strokeText(char, light.x + light.w/2, startY + index * charStep); });
					} else { ctx.strokeText(textToShow, light.x + light.w/2, light.y + light.h/2); }
				}
				ctx.fillStyle = isFlashingOff ? `hsl(${light.baseHue}, 70%, 20%)` : `hsl(${light.baseHue}, 100%, 75%)`; 
				ctx.globalAlpha = isFlashingOff ? 0.4 : 0.9 + Math.random() * 0.1;
				
				if (light.isVertical) { chars.forEach((char, index) => { ctx.fillText(char, light.x + light.w/2, startY + index * charStep); });
				} else { ctx.fillText(textToShow, light.x + light.w/2, light.y + light.h/2); }
				ctx.restore();
			}
		}
		ctx.globalAlpha = 1.0;
		ctx.restore(); 

		// BATCH 5: Traffic Chassis
		this.bgState.traffic.forEach(car => {
			const carAlpha = Math.max(0, Math.min(1, (t - car.popDelay) / 400));
			if (carAlpha === 0) return;
			ctx.globalAlpha = carAlpha;

			const depth = (car.y - horizon) / (h - horizon);
			let carW = (w * 0.012 + depth * w * 0.01) * 1.1; let carH = h * 0.008 + (depth * h * 0.005);
			if (car.type === 'truck') { carH *= 1.8; carW *= 0.85; } else if (car.type === 'coupe') { carH *= 0.8; carW *= 1.1; }

			ctx.fillStyle = car.chassisColor; ctx.fillRect(car.x - carW/2, car.y - carH/2, carW, carH);
			ctx.fillStyle = (car.directionIsLeft) ? car.chassisColor : '#1a222e'; 
			const roofOffsetX = (car.directionIsLeft) ? -carW*0.15 : carW*0.15;
			ctx.fillRect(car.x + roofOffsetX, car.y - carH/2 - carH*0.1, carW*0.7, carH*0.2); 
		});

		// BATCH 6: Traffic Lights Layering
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		this.bgState.traffic.forEach(car => {
			const carAlpha = Math.max(0, Math.min(1, (t - car.popDelay) / 400));
			if (carAlpha === 0) return;
			ctx.globalAlpha = carAlpha;

			const depth = (car.y - horizon) / (h - horizon);
			let carH = h * 0.008 + (depth * h * 0.005);
			const lightDrawH = carH * 2.5; const lightOffsetY = carH * 0.1;
			
			if (car.directionIsLeft) { 
				ctx.drawImage(this.bgState.headlightCache, car.x - lightDrawH/2, car.y + lightOffsetY - lightDrawH/2, lightDrawH, lightDrawH);
				ctx.drawImage(this.bgState.headlightCache, car.x - lightDrawH/2, car.y + lightOffsetY - lightDrawH/2, lightDrawH, lightDrawH); 
			} else { 
				const tLSize = lightDrawH * 0.7;
				ctx.drawImage(this.bgState.taillightCache, car.x - tLSize/2, car.y + lightOffsetY - tLSize/2, tLSize, tLSize);
				if (car.isBraking) {
					const bLSize = lightDrawH * 1.6; ctx.globalAlpha = 0.9 * carAlpha;
					ctx.drawImage(this.bgState.taillightCache, car.x - bLSize/2, car.y + lightOffsetY - bLSize/2, bLSize, bLSize);
					ctx.globalAlpha = carAlpha;
				}
			}
		});
		ctx.restore();

		// --- 8. LOW SEA MIST ---
		this.bgState.mist.forEach(m => {
			ctx.globalAlpha = m.op * Math.max(0, Math.min(1, (t - 600) / 800)); // Mist fades in slightly delayed
			ctx.drawImage(this.bgState.mistCache, m.x - m.r * 3, (horizon + m.y * 0.2) - m.r * 0.5, m.r * 6, m.r);
		});
		ctx.globalAlpha = 1.0;
	},
	
	// --- NEW: THE ELASTIC "POP" ANIMATION MATH ---
	getPopScale: function(elapsed, delay, duration = 1000) {
		// 1. Not time to pop yet
		if (elapsed < delay) return 0; 
		// 2. Finished popping, stay at normal size
		if (elapsed > delay + duration) return 1; 
		
		// 3. The "Spring/Bounce" Math
		let x = (elapsed - delay) / duration;
		const c4 = (2 * Math.PI) / 3;
		return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
	},
};

/* --- STATE MANAGEMENT --- */
const game = {
    mode: 'menu', 
    turnPhase: 1,
	currentBuildMom: 1, // For Character Build Screen.
    p1: { hp: 10, maxHp: 10, mom: 2, move: null, build: null, streak: 0, lastActionIndex: 0, lastActionIndex2: 0, lastActionIndex3: 0, totalAtks: 0, highUsed: 0, lowUsed: 0 },
    p2: { hp: 10, maxHp: 10, mom: 2, move: null, build: null, streak: 0, lastActionIndex: 0, lastActionIndex2: 0, lastActionIndex3: 0, totalAtks: 0, highUsed: 0, lowUsed: 0 },
    history: [], 
    unlockedGoldMawashi: false,
    isTutorial: false,
    tutorialStep: 0,
	achievementQueue: [],
	isNotifying: false,
	hasNewUnlocks: false,
	newUnlocksByCategory: { mawashi: false, skin: false, tech: false, dohyo: false},
	unseenItemIds: new Set(),
	speedMode: 1,      // 1 = Normal, 2 = Fast
    timeMult: 1.0,     // The multiplier applied to timers (1.0 or 0.3)
			
	// --- CAREER DATA ---
    career: {
        unlockedDiv: 0, // 0 to 5
        activeBasho: null, // { div: 0, wins: 0, losses: 0, history: [] }
        titles: [], // 'Komusubi', 'Sekiwake', etc.
		loadout: ['strike', 'sweep', 'thrust', 'throw'],
		bashoIndex: 0
    },
    
	DIVISIONS: [
		{ name: 'Jonokuchi', kanji: '序ノ口', maxMatches: 7,  kachiKoshi: 4 }, // Index 0
		{ name: 'Jonidan',   kanji: '序二段', maxMatches: 7,  kachiKoshi: 4 }, // Index 1
		{ name: 'Sandanme',  kanji: '三段目', maxMatches: 7,  kachiKoshi: 4 }, // Index 2
		{ name: 'Makushita', kanji: '幕下',   maxMatches: 7,  kachiKoshi: 4 }, // Index 3
		{ name: 'Juryo',     kanji: '十両',   maxMatches: 15, kachiKoshi: 8 }, // Index 4
		{ name: 'Makuuchi',  kanji: '幕内',   maxMatches: 15, kachiKoshi: 8 }  // Index 5
	],
	
	BASHO_CALENDAR: [
        { name: "Hatsu Basho", kanji: "初場所", month: "January" },
        { name: "Haru Basho", kanji: "春場所", month: "March" },
        { name: "Natsu Basho", kanji: "夏場所", month: "May" },
        { name: "Nagoya Basho", kanji: "名古屋場所", month: "July" },
        { name: "Aki Basho", kanji: "秋場所", month: "September" },
        { name: "Kyushu Basho", kanji: "九州場所", month: "November" }
    ],
    
    // Tracking current match specifics
    matchStats: { iron_walls: 0, used_high: false, used_low: false, rounds: 0, lastMove: null, moveStreak: 0, uniqueHits: [] },
	
	playerLoadout: ['strike', 'sweep', 'thrust', 'throw'], // Default Original Set
    
    achievements: {
        'fudo_shin': false,
        'hachinana': false,
        'yorikiri': false,
        'oshidashi': false,
        'tsuridashi': false,
		'kimarite': false,
        'shinitai': false,
        'ankogata': false,
        'deashi': false,
        'ginboshi': false,
		'kinboshi': false, 
		'zensho': false, 
		'mizu_iri': false, 
		'rensho': false,
		'sandan_gamae': false
	},

	stats: {
		local_played: 0, online_played: 0,
		style_b: 0, style_a: 0, style_d: 0,
		total_b: 0, total_a: 0, total_d: 0,
		hosho_kin: 0, finishing_moves: [],
		total_matches: 0, total_build_actions: 0,
		cpu_win_streak: 0,
	},
    
    sessionStats: { s_b: 0, s_a: 0, s_d: 0, t_b: 0, t_a: 0, t_d: 0 },
    statMode: 'success', 
    subtitleIndex: 0,
    subtitleInterval: null,
    subtitles: ["WILL & MOMENTUM","意志と勢い","LEARNING THROUGH LOSS","喪失を通じて学ぶ","HAKKEYOI!","はっけよい","NOKOTTA!","残った","MATTA-NASHI!","まったなし"],
    pendingBuild: null, 
    atm: { currentWind: 20, targetWind: 20, currentRot: 720, targetRot: 720 },
	practiceActive: false,
    practiceStats: { round: 0, maxRounds: 0, passes: 0, totalScorePercent: 0, history: [] },
    practiceTimer: null,

	// Hardcoded reference of all possible resource cards
	RESOURCE_CARDS: {
		'h_attack': { 
			name: 'High Kimarite', shortName: 'H ATTACK', desc: 'High Kimarite (+1)', 
			theme: 'theme-h-atk', isDynamicIcon: true 
		},
		'l_attack': { 
			name: 'Low Kimarite', shortName: 'L ATTACK', desc: 'Low Kimarite (+1)', 
			theme: 'theme-l-atk', isDynamicIcon: true 
		},
		'h_block':  { 
			name: 'High Guard', shortName: 'H BLOCK', desc: 'Block High (+1)', 
			theme: 'theme-h-block', iconKey: 'h_block', layout: 'icon-layout-1' 
		},
		'l_block':  { 
			name: 'Low Guard', shortName: 'L BLOCK', desc: 'Block Low (+1)', 
			theme: 'theme-l-block', iconKey: 'l_block', layout: 'icon-layout-1' 
		},
		'build':    { 
			name: 'Momentum', shortName: 'BUILD', desc: 'Build Momentum (+1)', 
			theme: 'theme-build', iconKey: 'build', layout: 'icon-layout-1' 
		},
		// --- RARE CARDS ---
		'waki_ga_katai': { 
			name: 'Waki Ga Katai (脇が堅い)', 
			shortName: 'WAKI', // Fixes text overflow!
			desc: 'Discard: Discards (+2)', 
			rarity: 'rare', 
			type: 'util',
			theme: 'theme-waki',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 40px; height: 40px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<polygon points="50,15 100,45 80,100 20,100 0,45" fill="#a9cce3" stroke="#2980b9" stroke-width="6" stroke-linejoin="round" transform="rotate(-20 50 50) translate(-15, 10) scale(0.65)"/>
						<polygon points="50,15 100,45 80,100 20,100 0,45" fill="#ebf5fb" stroke="#2980b9" stroke-width="6" stroke-linejoin="round" transform="rotate(20 50 50) translate(15, 10) scale(0.65)"/>
					</svg>
				</div>`
		},
		'chankonabe': { 
			name: 'Chankonabe (ちゃんこ鍋)', 
			shortName: 'CHANKO', // Fixes text overflow!
			desc: 'Discard: Draw (+3)', 
			rarity: 'rare', 
			type: 'util',
			theme: 'theme-waki',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 40px; height: 40px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<path d="M 20 45 L 80 45 C 80 85, 20 85, 20 45 Z" fill="#a9cce3" stroke="#2980b9" stroke-width="6" stroke-linejoin="round"/>
						<rect x="12" y="38" width="76" height="10" rx="4" fill="#ebf5fb" stroke="#2980b9" stroke-width="6" stroke-linejoin="round"/>
						<circle cx="35" cy="38" r="6" fill="#ebf5fb" stroke="#2980b9" stroke-width="3" />
						<circle cx="50" cy="35" r="8" fill="#a9cce3" stroke="#2980b9" stroke-width="3" />
						<circle cx="65" cy="38" r="5" fill="#ebf5fb" stroke="#2980b9" stroke-width="3" />
						<path d="M 35 25 Q 40 15 35 5" fill="none" stroke="#ebf5fb" stroke-width="4" stroke-linecap="round" opacity="0.8" />
						<path d="M 50 22 Q 45 12 50 2" fill="none" stroke="#a9cce3" stroke-width="4" stroke-linecap="round" opacity="0.8" />
						<path d="M 65 25 Q 70 15 65 5" fill="none" stroke="#ebf5fb" stroke-width="4" stroke-linecap="round" opacity="0.8" />
					</svg>
				</div>`
		},
		'nekodamashi': { 
			name: 'Nekodamashi (猫騙し)', 
			shortName: 'NEKO', 
			desc: 'Discard: Opp Discard 🚫', 
			rarity: 'rare', 
			type: 'util',
			theme: 'theme-waki',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<g transform="translate(50, 50)">
							<circle cx="0" cy="0" r="18" fill="none" stroke="#f1c40f" stroke-width="4" stroke-dasharray="6,4"/>
							<path d="M 0 -25 L 0 -40 M 0 25 L 0 40 M -25 0 L -40 0 M 25 0 L 40 0" stroke="#f1c40f" stroke-width="4" stroke-linecap="round"/>
							<path d="M -35 -20 C -15 -20 -10 -10 -10 0 C -10 10 -15 20 -35 20 Z" fill="#d35400" stroke="#fff" stroke-width="2"/>
							<path d="M 35 -20 C 15 -20 10 -10 10 0 C 10 10 15 20 35 20 Z" fill="#d35400" stroke="#fff" stroke-width="2"/>
						</g>
					</svg>
				</div>`
		},
		'shikiri_naoshi': { 
			name: 'Shikiri-naoshi (仕切り直し)', 
			shortName: 'SHIKIRI', 
			desc: 'Discard: Opp Redraw Hand', 
			rarity: 'rare', 
			type: 'util',
			theme: 'theme-waki',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<g stroke="#2980b9" stroke-width="4" stroke-linejoin="round">
							<polygon points="50,15 100,45 80,100 20,100 0,45" fill="#a9cce3"
								transform="rotate(-25 50 60) translate(-10, 5) scale(0.65)"/>
							
							<polygon points="50,15 100,45 80,100 20,100 0,45" fill="#ebf5fb"
								transform="rotate(15 50 60) translate(15, -10) scale(0.65)"/>
							
							<polygon points="50,15 100,45 80,100 20,100 0,45" fill="#a9cce3"
								transform="rotate(40 50 60) translate(30, 10) scale(0.65)"/>
						</g>
						
						<path d="M 5 80 Q 40 95 90 55" fill="none" stroke="#f1c40f" stroke-width="6" stroke-linecap="round" stroke-dasharray="16, 8"/>
						<path d="M 15 65 Q 45 75 75 40" fill="none" stroke="#f1c40f" stroke-width="4" stroke-linecap="round"/>
					</svg>
				</div>`
		},
		'w_attack': { 
			name: 'Kime-waza (決め技)', shortName: 'KIMEWAZA', desc: 'Wild Attack (+1)', 
			rarity: 'rare', type: 'util', theme: 'theme-waki', isDynamicIcon: true 
		},
		'w_block': { 
			name: 'Henka (変化)', shortName: 'HENKA', desc: 'Wild Block (+1)', 
			rarity: 'rare', type: 'util', theme: 'theme-waki', layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<path d="M50 90s35-15 35-40V20L50 8 15 20v30c0 25 35 40 35 40z" fill="#ebf5fb" stroke="#2980b9" stroke-width="6" stroke-linejoin="round"/>
						<path d="M50 45 V 15 M 35 30 L 50 15 L 65 30" stroke="#f1c40f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
						<path d="M50 55 V 85 M 35 70 L 50 85 L 65 70" stroke="#f1c40f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
						<line x1="25" y1="50" x2="75" y2="50" stroke="#2980b9" stroke-width="4" stroke-linecap="round"/>
					</svg>
				</div>`
		},
		// --- EPIC CARDS ---
		'w_wild': { 
			name: 'Shin-Gi-Tai (心技体)', shortName: 'SHINGI', desc: 'Any Action (+1)', 
			rarity: 'epic', type: 'util', theme: 'theme-suri', layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 56px; height: 56px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<circle cx="50" cy="50" r="38" fill="rgba(39, 174, 96, 0.2)" stroke="#27ae60" stroke-width="5" stroke-dasharray="10 6"/>
						<path d="M50 85s30-15 30-35V25L50 12 20 25v25c0 20 30 35 30 35z" fill="#2c3e50" stroke="#f1c40f" stroke-width="4" stroke-linejoin="round"/>
						<path d="M 35 35 L 65 65 M 65 35 L 35 65" stroke="#e74c3c" stroke-width="8" stroke-linecap="round"/>
						<circle cx="50" cy="50" r="8" fill="#c0392b" stroke="#fff" stroke-width="3"/>
					</svg>
				</div>`
		},
		'suri_ashi': { 
			name: 'Suri-Ashi (すり足)', 
			shortName: 'SURI-ASHI', 
			desc: 'Hold: Recovery+', 
			rarity: 'epic', 
			type: 'util',
			theme: 'theme-suri',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<defs>
							<g id="real-footprint" fill="#9b59b6">
								<path d="m236.45 587.18c5.7924 14.343 14.676 33.125 32.854 98.088 11.617 41.516 17.518 112.31 30.605 152.81 13.087 40.503 60.89 77.497 94.852 74.391 27.56-2.5205 46.16-13.574 58.842-37.023 8.5106-15.735 13.087-41.855 9.0983-74.15-3.9885-32.295-30.09-78.577-33.729-104.81-4.4113-31.804-5.8608-67.044-0.80381-100.9 3.1507-21.092 11.449-35.527 15.108-66.976 3.9532-33.977 5.0663-67.113 0.37278-86.929-5.8457-24.681-19.863-32.6-38.899-41.112-46.861-20.957-163.93 20.851-192.19 77.724-28.254 56.873 18.092 94.542 23.885 108.88z" />
								<path d="m442.14 339.51c0 29.192-16.789 52.857-37.5 52.857s-37.5-23.665-37.5-52.857 16.789-52.857 37.5-52.857 37.5 23.665 37.5 52.857z" />
								<path d="m360.36 346.69c2.3687 20.717-7.6259 38.873-22.323 40.553-14.698 1.6805-28.533-13.751-30.901-34.468-2.3687-20.717 7.6259-38.873 22.323-40.553 14.698-1.6805 28.533 13.751 30.901 34.468z" />
								<path d="m302.52 365.58c5.4217 19.856-1.6027 39.07-15.69 42.917-14.087 3.8465-29.902-9.1316-35.323-28.987-5.4217-19.856 1.6027-39.07 15.69-42.917 14.087-3.8465 29.902 9.1316 35.323 28.987z" />
								<path d="m251.69 393.24c6.8816 17.285 2.5189 35.256-9.7443 40.138-12.263 4.8822-27.783-5.1725-34.665-22.458-6.8816-17.285-2.5189-35.256 9.7443-40.138 12.263-4.8822 27.783 5.1725 34.665 22.458z" />
								<path d="m207.06 428.72c8.4265 13.482 7.5037 29.258-2.0612 35.236-9.5649 5.9783-24.15-0.10464-32.576-13.587-8.4265-13.482-7.5037-29.258 2.0612-35.236 9.5649-5.9782 24.15 0.10467 32.576 13.587z" />
							</g>
						</defs>
						
						<use href="#real-footprint" transform="translate(0, -25) scale(0.08) rotate(-15 300 450)" />
						
						<use href="#real-footprint" transform="translate(100, 10) scale(-0.08, 0.08) rotate(-15 300 450)" />
					</svg>
				</div>`
		},
		'osoji': { 
			name: 'Ōsōji (大掃除)', 
			shortName: 'ŌSŌJI', 
			desc: 'Discard: Redraw Hand', 
			rarity: 'epic', 
			type: 'util',
			theme: 'theme-suri', // Reusing your epic purple theme
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<g transform="translate(10, 35) scale(0.85) rotate(-10)">
							<path d="M 10 60 Q 30 70 50 60 L 60 20 L 20 20 Z" fill="#8B5A2B"/>
							<path d="M 20 20 L 60 20 L 65 0 L 15 0 Z" fill="#6b4226"/>
							<path d="M 15 0 L 20 20 L 10 60 Z" fill="#a0522d"/>
							<path d="M 65 0 L 60 20 L 50 60 Z" fill="#5c3a21"/>
						</g>
						
						<g transform="translate(40, 5) scale(0.9) rotate(20)">
							<rect x="22" y="0" width="6" height="45" fill="#3E2723" rx="2"/>
							<path d="M 15 40 Q 25 35 35 40 L 45 85 Q 25 90 5 85 Z" fill="#8D6E63"/>
							<path d="M 14 50 Q 25 48 36 50" fill="none" stroke="#D7CCC8" stroke-width="2"/>
							<path d="M 11 60 Q 25 58 39 60" fill="none" stroke="#D7CCC8" stroke-width="2"/>
						</g>
						
						<path d="M 80 20 L 82 28 L 90 30 L 82 32 L 80 40 L 78 32 L 70 30 L 78 28 Z" fill="#FFD700" transform="scale(0.5) translate(40, -10)"/>
						<path d="M 20 80 L 21 84 L 25 85 L 21 86 L 20 90 L 19 86 L 15 85 L 19 84 Z" fill="#FFD700" transform="scale(0.6) translate(-10, -20)"/>
					</svg>
				</div>`
		},
		'mawashi_grip': { 
			name: 'Mawashi-Grip (廻し)', 
			shortName: 'MAWGRIP', 
			desc: 'Hold: Guard Break 🚫', 
			rarity: 'epic', 
			type: 'util',
			theme: 'theme-suri', // Using your Epic purple theme
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<rect x="10" y="35" width="80" height="30" rx="5" fill="#34495e" stroke="#2c3e50" stroke-width="4" />
						<path d="M 20 35 L 20 65 M 40 35 L 40 65 M 60 35 L 60 65 M 80 35 L 80 65" stroke="#2c3e50" stroke-width="4" />
						<g transform="translate(50, 50)">
							<rect x="-15" y="-20" width="30" height="40" rx="8" fill="#9b59b6" stroke="#fff" stroke-width="3" />
							<path d="M -15 -10 C -25 -10 -25 5 -15 5" fill="#8e44ad" stroke="#fff" stroke-width="3" />
							<path d="M -15 0 C -25 0 -25 15 -15 15" fill="#8e44ad" stroke="#fff" stroke-width="3" />
							<path d="M -15 10 C -25 10 -25 25 -15 25" fill="#8e44ad" stroke="#fff" stroke-width="3" />
							<path d="M -15 -20 C -25 -20 -25 -5 -15 -5" fill="#8e44ad" stroke="#fff" stroke-width="3" />
							<path d="M 10 -20 C 25 -30 25 -10 15 -5" fill="#8e44ad" stroke="#fff" stroke-width="3" />
						</g>
					</svg>
				</div>`
		},
		'soppugata': { 
			name: 'Soppugata (ソップ型)', 
			shortName: 'SOPPUGATA', 
			desc: 'Hold: Block Recoil (+1)', 
			rarity: 'epic', 
			type: 'util',
			theme: 'theme-suri', // Using your Epic purple theme
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<path d="M 10 20 L 25 35 M 5 45 L 25 50 M 10 70 L 25 60" stroke="#f1c40f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
						<polygon points="25,45 35,35 30,50 40,60 25,55" fill="#f1c40f" />
						
						<path d="M 45 10 C 20 30 20 70 45 90 C 80 90 95 60 95 50 C 95 40 80 10 45 10 Z" fill="#e6a87c" stroke="#9b59b6" stroke-width="4" />
						<path d="M 75 50 C 70 45 65 55 75 50" fill="none" stroke="#c0392b" stroke-width="3" stroke-linecap="round" />
						<path d="M 40 85 C 60 95 85 85 95 70" fill="none" stroke="#2c3e50" stroke-width="6" stroke-linecap="round" />
						<path d="M 40 25 C 25 40 25 60 40 75" fill="none" stroke="#fff" stroke-width="3" opacity="0.6" stroke-linecap="round" />
					</svg>
				</div>`
		},
		'tsuppari': { 
			name: 'Tsuppari (突っ張り)', 
			shortName: 'TSUPPARI', 
			desc: 'Hold: Attack (+1)', 
			rarity: 'epic', 
			type: 'util',
			theme: 'theme-suri', 
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<defs>
							<g id="tsuppari-palm">
								<rect x="-15" y="-30" width="7.5" height="25" rx="3.75" fill="#e6a87c" stroke="#8e44ad" stroke-width="2" />
								<rect x="-5.5" y="-34" width="7.5" height="29" rx="3.75" fill="#e6a87c" stroke="#8e44ad" stroke-width="2" />
								<rect x="4" y="-32" width="7.5" height="27" rx="3.75" fill="#e6a87c" stroke="#8e44ad" stroke-width="2" />
								<rect x="13.5" y="-25" width="7.5" height="20" rx="3.75" fill="#e6a87c" stroke="#8e44ad" stroke-width="2" />
								
								<g transform="translate(-16, -2) rotate(-40)">
									<rect x="-4" y="-14" width="8" height="18" rx="4" fill="#e6a87c" stroke="#8e44ad" stroke-width="2" />
								</g>
								
								<path d="M -16,-8 L 16,-8 C 20,-8 22,10 16,18 L -16,18 C -22,10 -22,-8 -16,-8 Z" fill="#e6a87c" stroke="#8e44ad" stroke-width="2.5" stroke-linejoin="round"/>
								
								<path d="M -8,8 Q 0,14 8,8" fill="none" stroke="#9b59b6" stroke-width="2" stroke-linecap="round"/>
								<path d="M -6,0 L 4,-4" fill="none" stroke="#9b59b6" stroke-width="1.5" stroke-linecap="round"/>
							</g>
						</defs>

						<g stroke-linecap="round" opacity="0.6">
							<path d="M 20,90 L 20,-10" stroke="#f1c40f" stroke-width="3" stroke-dasharray="10,15" />
							<path d="M 50,100 L 50,-20" stroke="#f1c40f" stroke-width="4" stroke-dasharray="15,20" opacity="0.8"/>
							<path d="M 80,95 L 80,5" stroke="#f1c40f" stroke-width="3" stroke-dasharray="8,12" />
							<path d="M 35,80 L 35,0" stroke="#fff" stroke-width="2" stroke-dasharray="6,10" opacity="0.7"/>
							<path d="M 65,85 L 65,-5" stroke="#fff" stroke-width="2" stroke-dasharray="12,16" opacity="0.7"/>
						</g>

						<g transform="translate(25, 40) scale(0.65) rotate(-15)">
							<ellipse cx="0" cy="-35" rx="25" ry="10" fill="none" stroke="#f1c40f" stroke-width="4" opacity="0.5" />
							<use href="#tsuppari-palm" opacity="0.7"/>
						</g>
						
						<g transform="translate(78, 55) scale(0.85) rotate(10)">
							<ellipse cx="0" cy="-38" rx="30" ry="12" fill="none" stroke="#f1c40f" stroke-width="4" opacity="0.8" />
							<use href="#tsuppari-palm" />
						</g>
						
						<g transform="translate(48, 80) scale(1.2) rotate(-5)">
							<ellipse cx="0" cy="-38" rx="35" ry="14" fill="none" stroke="#fff" stroke-width="3" opacity="0.9" />
							<path d="M -25,-45 Q 0,-60 25,-45" fill="none" stroke="#f1c40f" stroke-width="5" stroke-linecap="round"/>
							<use href="#tsuppari-palm" />
						</g>
					</svg>
				</div>`
		},
		// --- LEGENDARY CARDS ---
		'kimedashi': { 
			name: 'Kimedashi (決め出し)', 
			shortName: 'KIMEDASHI', 
			desc: 'Hold: Iron Wall (x2)', 
			rarity: 'legendary', 
			type: 'util',
			theme: 'theme-kime',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						
						<g transform="translate(50, 65) scale(0.9) rotate(5)">
							<path d="M-20,-15 C-25,-10 -25,10 -20,15 C-15,20 15,20 20,15 C25,10 25,-10 20,-15 Z" fill="#b1940a" stroke="none"/>
							<path d="M0,15 C-5,18 -5,22 -5,25 L5,25 C5,22 5,18 0,15 Z" fill="#b1940a" stroke="none"/>
							<circle cx="-13" cy="-7" r="4" fill="#8e7708" stroke="none"/>
							<circle cx="-5" cy="-9" r="4" fill="#8e7708" stroke="none"/>
							<circle cx="5" cy="-9" r="4" fill="#8e7708" stroke="none"/>
							<circle cx="13" cy="-7" r="4" fill="#8e7708" stroke="none"/>
							<path d="M-15,-10 C-18,-13 -18,-17 -15,-20 C-12,-23 -8,-23 -5,-20 Z" fill="#8e7708" stroke="none"/>
						</g>
						
						<g transform="translate(50, 45) scale(1.1) rotate(-5)">
							<circle cx="0" cy="5" r="30" fill="rgba(0,0,0,0.15)" stroke="none"/>
							<path d="M-20,-15 C-25,-10 -25,10 -20,15 C-15,20 15,20 20,15 C25,10 25,-10 20,-15 Z" fill="#f1c40f" stroke="none"/>
							<path d="M0,-15 C-5,-18 -5,-22 -5,-25 L5,-25 C5,-22 5,-18 0,-15 Z" fill="#f1c40f" stroke="none"/>
							<circle cx="-13" cy="-7" r="4" fill="#fcf3cf" stroke="none"/>
							<circle cx="-5" cy="-9" r="4" fill="#fcf3cf" stroke="none"/>
							<circle cx="5" cy="-9" r="4" fill="#fcf3cf" stroke="none"/>
							<circle cx="13" cy="-7" r="4" fill="#fcf3cf" stroke="none"/>
							<path d="M-15,-10 C-18,-13 -18,-17 -15,-20 C-12,-23 -8,-23 -5,-20 Z" fill="#fcf3cf" stroke="none"/>
							<line x1="-10" y1="18" x2="-8" y2="25" stroke="#f1c40f" stroke-width="2" stroke-linecap="round"/>
							<line x1="0" y1="20" x2="0" y2="28" stroke="#f1c40f" stroke-width="2" stroke-linecap="round"/>
							<line x1="10" y1="18" x2="8" y2="25" stroke="#f1c40f" stroke-width="2" stroke-linecap="round"/>
						</g>
						
						<circle cx="50" cy="55" r="6" fill="#ffffff" opacity="0.9"/>
						<line x1="50" y1="50" x2="50" y2="60" stroke="#f1c40f" stroke-width="1" opacity="0.8"/>
						<line x1="45" y1="55" x2="55" y2="55" stroke="#f1c40f" stroke-width="1" opacity="0.8"/>
					</svg>
				</div>`
		},
		'hassotobi': { 
			name: 'Hassotobi (八艘飛び)', 
			shortName: 'HASSOTOBI', 
			desc: 'Hold: ⭐ Recovery', 
			rarity: 'legendary', 
			type: 'util',
			theme: 'theme-kime',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 48px; height: 48px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.5));">
						<g transform="translate(15, 75) scale(0.9)">
							<path d="M-15,0 L0,8 L20,-5 L5,-12 Z" fill="#8e7708" stroke="none"/>
							<path d="M-15,0 L0,8 L0,15 L-15,7 Z" fill="#6a5906" stroke="none"/>
							<path d="M0,8 L20,-5 L20,2 L0,15 Z" fill="#4a3e04" stroke="none"/>
						</g>
						<g transform="translate(45, 55) scale(1)">
							<path d="M-15,0 L0,8 L20,-5 L5,-12 Z" fill="#b1940a" stroke="none"/>
							<path d="M-15,0 L0,8 L0,15 L-15,7 Z" fill="#8e7708" stroke="none"/>
							<path d="M0,8 L20,-5 L20,2 L0,15 Z" fill="#6a5906" stroke="none"/>
						</g>
						<g transform="translate(80, 35) scale(1.1)">
							<path d="M-15,0 L0,8 L20,-5 L5,-12 Z" fill="#f1c40f" stroke="none"/>
							<path d="M-15,0 L0,8 L0,15 L-15,7 Z" fill="#b1940a" stroke="none"/>
							<path d="M0,8 L20,-5 L20,2 L0,15 Z" fill="#8e7708" stroke="none"/>
						</g>
						<path d="M 22 68 Q 30 35 45 52" fill="none" stroke="#f1c40f" stroke-width="2.5" stroke-dasharray="4,4" stroke-linecap="round"/>
						<path d="M 52 48 Q 65 15 80 32" fill="none" stroke="#fcf3cf" stroke-width="2.5" stroke-dasharray="4,4" stroke-linecap="round"/>
						<circle cx="68" cy="24" r="4" fill="#ffffff" filter="drop-shadow(0 0 4px #fff)"/>
						<path d="M 64 28 L 72 28 L 68 20 Z" fill="#ffffff"/>
					</svg>
				</div>`
		},
		'a_gyo': { 
			name: 'A-gyō (阿形)', 
			shortName: 'A-GYŌ', 
			desc: 'Hold: Seal (Needs Un-Gyō)', 
			rarity: 'legendary', 
			type: 'util',
			theme: 'theme-kime',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 56px; height: 56px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 6px 4px rgba(0,0,0,0.7));">
						<defs>
							<radialGradient id="fireGrad" cx="50%" cy="50%" r="50%">
								<stop offset="0%" stop-color="#f39c12"/>
								<stop offset="70%" stop-color="#c0392b"/>
								<stop offset="100%" stop-color="#78281f"/>
							</radialGradient>
							<linearGradient id="goldTrim" x1="0%" y1="0%" x2="100%" y2="100%">
								<stop offset="0%" stop-color="#f1c40f"/>
								<stop offset="50%" stop-color="#f39c12"/>
								<stop offset="100%" stop-color="#d35400"/>
							</linearGradient>
						</defs>
						
						<path d="M50 0 L56 18 L75 8 L67 26 L88 25 L75 40 L98 50 L75 60 L88 75 L67 74 L75 92 L56 82 L50 100 L44 82 L25 92 L33 74 L12 75 L25 60 L2 50 L25 40 L12 25 L33 26 L25 8 L44 18 Z" fill="url(#fireGrad)" stroke="url(#goldTrim)" stroke-width="2" stroke-linejoin="round"/>
						
						<circle cx="50" cy="50" r="30" fill="#641e16" stroke="url(#goldTrim)" stroke-width="3"/>
						<circle cx="50" cy="50" r="24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-dasharray="2,6" stroke-linecap="round"/>

						<polygon points="32,25 20,5 42,28" fill="url(#goldTrim)"/>
						<polygon points="68,25 80,5 58,28" fill="url(#goldTrim)"/>
						
						<path d="M 25 40 L 15 55 L 30 65 Z" fill="#922b21"/>
						<path d="M 75 40 L 85 55 L 70 65 Z" fill="#922b21"/>

						<path d="M 30 35 L 50 22 L 70 35 L 75 55 L 50 85 L 25 55 Z" fill="#e74c3c" stroke="#f1c40f" stroke-width="2"/>
						
						<polygon points="32,45 46,38 43,48" fill="#fff"/>
						<circle cx="41" cy="44" r="2" fill="#000"/>
						<polygon points="68,45 54,38 57,48" fill="#fff"/>
						<circle cx="59" cy="44" r="2" fill="#000"/>

						<path d="M 28 36 Q 40 28 50 38 Q 60 28 72 36" fill="none" stroke="url(#goldTrim)" stroke-width="4" stroke-linecap="round"/>

						<path d="M 35 62 Q 50 80 65 62 Q 50 68 35 62 Z" fill="#000" stroke="url(#goldTrim)" stroke-width="1.5"/>
						
						<polygon points="38,64 41,74 44,65" fill="#fff"/>
						<polygon points="62,64 59,74 56,65" fill="#fff"/>
						<polygon points="46,72 48,66 50,70" fill="#fff"/>
						<polygon points="54,72 52,66 50,70" fill="#fff"/>
					</svg>
				</div>`
		},
		'un_gyo': { 
			name: 'Un-gyō (吽形)', 
			shortName: 'UN-GYŌ', 
			desc: 'Hold: Seal (Needs A-Gyō)', 
			rarity: 'legendary', 
			type: 'util',
			theme: 'theme-kime',
			layout: 'icon-layout-1',
			svg: `
				<div class="card-icon-slot" style="width: 56px; height: 56px;">
					<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0px 6px 4px rgba(0,0,0,0.7));">
						<defs>
							<radialGradient id="waterGrad" cx="50%" cy="50%" r="50%">
								<stop offset="0%" stop-color="#2980b9"/>
								<stop offset="70%" stop-color="#1a5276"/>
								<stop offset="100%" stop-color="#154360"/>
							</radialGradient>
							<linearGradient id="silverTrim" x1="0%" y1="0%" x2="100%" y2="100%">
								<stop offset="0%" stop-color="#ecf0f1"/>
								<stop offset="50%" stop-color="#bdc3c7"/>
								<stop offset="100%" stop-color="#7f8c8d"/>
							</linearGradient>
						</defs>
						
						<path d="M50 2 C65 2 72 15 85 15 C98 15 95 28 95 40 C95 55 105 60 85 75 C75 82 75 98 50 98 C25 98 25 82 15 75 C-5 60 5 55 5 40 C5 28 2 15 15 15 C28 15 35 2 50 2 Z" fill="url(#waterGrad)" stroke="url(#silverTrim)" stroke-width="2" stroke-linejoin="round"/>
						
						<circle cx="50" cy="50" r="30" fill="#154360" stroke="url(#silverTrim)" stroke-width="3"/>
						<circle cx="50" cy="50" r="24" fill="none" stroke="#3498db" stroke-width="2" stroke-dasharray="10,4" stroke-linecap="round"/>

						<path d="M 32 25 Q 25 5 45 15 Z" fill="url(#silverTrim)"/>
						<path d="M 68 25 Q 75 5 55 15 Z" fill="url(#silverTrim)"/>
						
						<path d="M 25 40 Q 15 50 30 65 Z" fill="#1f618d"/>
						<path d="M 75 40 Q 85 50 70 65 Z" fill="#1f618d"/>

						<path d="M 28 35 L 50 30 L 72 35 L 70 65 Q 50 75 30 65 Z" fill="#2471a3" stroke="url(#silverTrim)" stroke-width="2"/>
						
						<polygon points="32,45 48,46 32,49" fill="#fff"/>
						<circle cx="44" cy="47" r="1.5" fill="#000"/>
						<polygon points="68,45 52,46 68,49" fill="#fff"/>
						<circle cx="56" cy="47" r="1.5" fill="#000"/>

						<path d="M 25 40 Q 35 44 48 42 M 75 40 Q 65 44 52 42" fill="none" stroke="url(#silverTrim)" stroke-width="4" stroke-linecap="round"/>

						<path d="M 35 65 Q 50 68 65 65" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>
						
						<polygon points="38,66 40,54 43,67" fill="#fff"/>
						<polygon points="62,66 60,54 57,67" fill="#fff"/>
						
						<polygon points="45,68 55,68 50,73" fill="url(#silverTrim)"/>
					</svg>
				</div>`
		},
	},
	
    init: function() {
		this.createPetals(true);
		
		this.music = new StemMusicEngine();
		
		this.loadStats();
		this.loadLoadout();
		this.loadCosmetics();
		
		this.gamepadActive = false;
		this.prevButtonState = []; 
		this.gamepadLoopId = null; // NEW: Stores the loop ID so we can kill duplicates
		this.initGamepad();
		
		if (!this.career.quickPlay) {
			this.career.quickPlay = {
				local: { wins: 0, played: 0 },
				online: { wins: 0, played: 0 },
				div_0: { wins: 0, played: 0 },
				div_1: { wins: 0, played: 0 },
				div_2: { wins: 0, played: 0 },
				div_3: { wins: 0, played: 0 },
				div_4: { wins: 0, played: 0 },
				div_5: { wins: 0, played: 0 }
			};
		}
		
		// Initialize Guest Account for Matchmaking if no user is logged in.
		firebase.auth().onAuthStateChanged((user) => {
			if (user) {
				window.currentUserUID = user.uid;

				// 1. Update the "Phone Book" so others can find this player by email
				if (user.email) {
					db.collection("users").doc(user.uid).set({
						uid: user.uid,
						email: user.email.toLowerCase(), // Always store lowercase for easier searching
						name: game.getLocalName()
					}, { merge: true });
				}

				const uidDisplay = document.getElementById('uid-text');
				if (uidDisplay) uidDisplay.innerText = user.uid;

				if (typeof net !== 'undefined' && net.listenForInvites) {
					net.listenForInvites();
				}
			} else {
				firebase.auth().signInAnonymously();
			}
		});

		
		if (this.career && !this.career.unlockedMoves) {
			this.career.unlockedMoves = ['strike', 'sweep', 'thrust', 'throw'];
		}

		// Reset Loadout Default
		if (!this.playerLoadout || this.playerLoadout.length === 0) {
			this.playerLoadout = ['strike', 'sweep', 'thrust', 'throw'];
		}
		
		BackgroundManager.init('game-board'); 
		BackgroundManager.hide(); // <-- NEW: Initialize but stay hidden/dormant on boot!
		
		// --- REHYDRATE COSMETICS ---
		const savedCosmetics = localStorage.getItem('sumo_player_cosmetics');
		if (savedCosmetics) {
			try {
				this.playerCosmetics = JSON.parse(savedCosmetics);
				// This ensures the rikishi on the title screen and in the arena 
				// wear your gear immediately on load.
				this.resetAvatars(true);
			} catch (e) {
				console.error("Cosmetic data corrupted, resetting.");
				this.playerCosmetics = { mawashi: 'maw_black', skin: 'skin_sumo' };
			}
		}
		
		// 1. Attach the worker and state variables to the game object
		this.aiWorker = new Worker('./ai-worker.js');
		this.isAiReady = false;
		this.pendingAiResolve = null;

		// 2. Set up the listener using an arrow function
		this.aiWorker.onmessage = (e) => {
			if (e.data.type === 'LOADED') {
				this.isAiReady = true;
				console.log(`[Worker] AI is awake! Loaded: ${e.data.file}`);
			}
			
			if (e.data.type === 'RESULT') {
				if (this.pendingAiResolve) {
					this.pendingAiResolve(e.data.outputs);
					this.pendingAiResolve = null;
				}
			}
			
			if (e.data.type === 'ERROR') {
				console.error("[Worker Error]", e.data.message);
			}
		};
		
		// Keybinding (Corrected for your script logic)
		window.addEventListener('keydown', (e) => {
			// --- NEW: Abort all combat inputs if QTE is running ---
			// (The Spacebar is handled entirely inside the QTE function now, 
			// so we want to block it from doing anything else here)
			if (this.qteActive) {
				if (e.code === 'Space') e.preventDefault(); 
				return;
			}

			// 1. Prevent "Machine Gun" firing if key is held
			if (e.repeat) return; 

			const key = e.key.toLowerCase();
			const isSpeedKey = (key === 'f');
			const isNumberKey = ['1', '2', '3', '4', '5'].includes(key);

			// Add 'v' to your existing keyMap block!
			const keyMap = {
				'w': { id: 'btn-build',  fn: () => this.submitMove(this.turnPhase, 'build') },
				'a': { id: 'btn-h_block', fn: () => this.submitMove(this.turnPhase, 'h_block') },
				's': { id: 'atk-0',       fn: () => this.handleAttackByKey(0) },
				'd': { id: 'atk-1',       fn: () => this.handleAttackByKey(1) },
				'z': { id: 'btn-l_block', fn: () => this.submitMove(this.turnPhase, 'l_block') },
				'x': { id: 'atk-2',       fn: () => this.handleAttackByKey(2) },
				'c': { id: 'atk-3',       fn: () => this.handleAttackByKey(3) },
				'v': { id: 'atk-4',       fn: () => this.handleAttackByKey(4) }, // <-- NEW: 5TH SLOT MAPPED TO 'V'
				'f': { id: 'btn-speed',   fn: () => this.toggleSpeed() }
			};

			// 2. ONLY process keys that are in our keymap OR number keys. 
			if (!keyMap[key] && !isNumberKey) {
				// Prevent Space/Enter from accidentally clicking UI buttons that still have focus
				if (e.code === 'Space' || e.code === 'Enter') {
					e.preventDefault(); 
				}
				return; 
			}

			// 3. Allow 'F' even during CPU turn or with overlays, 
			// but keep combat and discard keys restricted.
			if (!isSpeedKey) {
				if (this.turnPhase === 2 && this.mode === 'cpu') return;
				if (document.querySelector('.overlay:not(.hidden)')) return;
				
				// --- THE FIX: MUTE LISTENERS DURING EXIT ANIMATIONS ONLY ---
				const controls = document.getElementById('controls');
				if (!controls || controls.innerHTML.trim() === '') return;
				
				// Removed the entry classes! Only block inputs if cards are actually exiting/discarding.
				if (document.querySelector('.card-play-out, .card-swoop-out, .discarding, .opp-discard-shoot')) return;
			}

			// --- NEW: THE ONE-TWO DISCARD SYSTEM ---
			if (isNumberKey) {
				const index = parseInt(key) - 1;
				const p = this.turnPhase === 1 ? this.p1 : this.p2;

				// Ensure the array data exists
				if (!p.hand || index >= p.hand.length) return;

				// Ensure the physical HTML element exists
				const cardEl = document.getElementById(`activity-card-${index}`);
				if (!cardEl) return;

				// SECOND PRESS: Confirm Discard (Only fires if this exact card is already hovered)
				if (this.keyboardHoveredCardIndex === index && cardEl.classList.contains('card-sim-hover')) {
					this.keyboardHoveredCardIndex = null;
					// We pass 'true' for isSwipeUp so the entire card shakes on failure!
					this.cycleCard(this.turnPhase, index, null, true);
				}
				// FIRST PRESS: Hover
				else {
					// Wipe any existing hovers to prevent multiple popped-up cards
					document.querySelectorAll('.card-sim-hover').forEach(el => el.classList.remove('card-sim-hover'));
					
					this.keyboardHoveredCardIndex = index;
					cardEl.classList.add('card-sim-hover');
					
					// --- THE FIX: Calculate spatial pan dynamically based on whose turn it is! ---
					const spatialPan = this.turnPhase === 1 ? -0.6 : 0.6;
					if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan); 
				}
				return;
			}

			// 4. Execute the mapped function
			const mapping = keyMap[key];
			const target = document.getElementById(mapping.id);
			
			// SPEED KEY SPECIAL CASE: Execute even if no button exists
			if (isSpeedKey) {
				sound.play('click');
				mapping.fn();
				
				// Still try to flash the button if it happens to exist
				if (target) {
					target.classList.add('active-press');
					setTimeout(() => target.classList.remove('active-press'), 100);
				}
			} 
			// NORMAL COMBAT KEYS: Must have a visible, enabled button
			else if (target && !target.disabled) {
				target.classList.add('active-press');
				setTimeout(() => target.classList.remove('active-press'), 100);
				sound.play('click');
				mapping.fn();
			}
		});
		if (!this.career.stats) {
			this.career.stats = {};
		}
		
		// Deep merge to protect against legacy saves crashing the Records screen
		if (!this.career.stats.bashosFinished) this.career.stats.bashosFinished = [0,0,0,0,0,0];
		if (!this.career.stats.bestRecordWins) this.career.stats.bestRecordWins = [0,0,0,0,0,0];
		if (!this.career.stats.sanyakuMatches) this.career.stats.sanyakuMatches = { "Komusubi": 0, "Sekiwake": 0, "Ozeki": 0, "Yokozuna": 0 };
		if (this.career.stats.highestDiv === undefined) this.career.stats.highestDiv = this.career.unlockedDiv || 0;
		this.saveCareer();
		this.startSubtitleCycle();
		this.startAtmosphereLoop();
		this.scheduleHPGleam();
		this.startCrowdLoop();
		this.startIdleLoop();
		
		const heyaBtn = document.getElementById('global-heya-btn');
		if (heyaBtn) heyaBtn.classList.remove('hidden');

		// We check if the 'has_visited' flag exists in storage
		const hasVisited = localStorage.getItem('sumo_has_visited');

		if (!hasVisited) {
			// NEW: Instantly hide the title screen and throw up the overlay
			document.getElementById('title-screen').classList.add('hidden');
			const cinOverlay = document.getElementById('cinematic-overlay');
			if (cinOverlay) {
				cinOverlay.classList.remove('hidden');
				cinOverlay.style.display = 'flex';
				// Force background to pitch black instantly
				cinOverlay.style.backgroundColor = '#000'; 
			}

			localStorage.setItem('sumo_has_visited', 'true');

			// We can reduce this timeout now since the screen is safely covered
			setTimeout(() => {
				console.log("Welcome, New Rikishi. Initializing initiation...");
				this.startCPU('tutorial');
			}, 100); 
		}
		BootManager.update('Building Dohyō (土俵)...');
	},
	
	initGamepad: function() {
		// THE FIX 1: Prevent double-binding event listeners if init() runs twice
		if (this._gamepadInitialized) return;
		this._gamepadInitialized = true;

		window.addEventListener("gamepadconnected", (e) => {
			console.log("🎮 Gamepad connected:", e.gamepad.id);
			this.gamepadActive = true;
			if (this.gamepadLoopId) cancelAnimationFrame(this.gamepadLoopId);
			this.pollGamepad(); 
		});

		window.addEventListener("gamepaddisconnected", (e) => {
			console.log("🎮 Gamepad disconnected");
			this.gamepadActive = false;
			if (this.gamepadLoopId) {
				cancelAnimationFrame(this.gamepadLoopId);
				this.gamepadLoopId = null;
			}
		});
	},

	pollGamepad: function() {
		if (!this.gamepadActive) return;

		const gamepads = navigator.getGamepads();
		const gp = gamepads[0]; 

		if (gp) {
			this.processGamepadInput(gp);
		}

		// THE FIX 1 (cont): Store the animation frame ID
		this.gamepadLoopId = requestAnimationFrame(() => this.pollGamepad());
	},

	processGamepadInput: function(gp) {
		if (this.qteActive) return; 

		const justPressed = (btnIdx) => {
			if (!gp.buttons[btnIdx]) return false; 
			const isPressed = gp.buttons[btnIdx].pressed;
			const wasPressed = this.prevButtonState[btnIdx];
			this.prevButtonState[btnIdx] = isPressed; 
			return isPressed && !wasPressed;
		};

		// 1. SPEED TOGGLE
		if (justPressed(9)) { // Start/Options
			sound.play('click');
			this.toggleSpeed();
			const target = document.getElementById('btn-speed');
			if (target) {
				target.classList.add('active-press');
				setTimeout(() => target.classList.remove('active-press'), 100);
			}
			return; 
		}

		// --- THE FIX 2: ZERO ALLOCATION CHECKING ---
		// We manually check buttons instead of building arrays to use .some()
		let combatBtn = -1;
		if (justPressed(0)) combatBtn = 0;
		else if (justPressed(1)) combatBtn = 1;
		else if (justPressed(2)) combatBtn = 2;
		else if (justPressed(3)) combatBtn = 3;
		else if (justPressed(4)) combatBtn = 4;
		else if (justPressed(5)) combatBtn = 5;
		else if (justPressed(6)) combatBtn = 6;
		else if (justPressed(7)) combatBtn = 7;

		let dpadBtn = -1;
		if (justPressed(12)) dpadBtn = 12;
		else if (justPressed(14)) dpadBtn = 14;
		else if (justPressed(15)) dpadBtn = 15;

		// If no buttons pressed, abort! No DOM checks!
		if (combatBtn === -1 && dpadBtn === -1) return;

		// --- THE BLOCKADES ---
		if (this.turnPhase === 2 && this.mode === 'cpu') return;
		if (document.querySelector('.overlay:not(.hidden)')) return;
		
		const controls = document.getElementById('controls');
		if (!controls || controls.innerHTML.trim() === '') return;
		if (document.querySelector('.card-play-out, .card-swoop-out, .discarding, .opp-discard-shoot')) return;

		// --- ZERO-ALLOCATION COMBAT MAPPING ---
		if (combatBtn !== -1) {
			let targetId = null;
			let actionFn = null;

			// Switch statements are incredibly fast and use no memory
			switch(combatBtn) {
				case 0: targetId = 'atk-0';       actionFn = () => this.handleAttackByKey(0); break;
				case 1: targetId = 'atk-1';       actionFn = () => this.handleAttackByKey(1); break;
				case 2: targetId = 'atk-2';       actionFn = () => this.handleAttackByKey(2); break;
				case 3: targetId = 'atk-3';       actionFn = () => this.handleAttackByKey(3); break;
				case 5: targetId = 'atk-4';       actionFn = () => this.handleAttackByKey(4); break;
				case 4: targetId = 'btn-h_block'; actionFn = () => this.submitMove(this.turnPhase, 'h_block'); break;
				case 6: targetId = 'btn-l_block'; actionFn = () => this.submitMove(this.turnPhase, 'l_block'); break;
				case 7: targetId = 'btn-build';   actionFn = () => this.submitMove(this.turnPhase, 'build'); break;
			}

			if (targetId && actionFn) {
				const target = document.getElementById(targetId);
				if (target && !target.disabled) {
					target.classList.add('active-press');
					setTimeout(() => target.classList.remove('active-press'), 100);
					sound.play('click');
					actionFn();
				}
			}
		}

		// --- ZERO-ALLOCATION DISCARD SYSTEM ---
		if (dpadBtn !== -1) {
			const p = this.turnPhase === 1 ? this.p1 : this.p2;
			const maxIndex = (p.hand && p.hand.length > 0) ? p.hand.length - 1 : 0;

			if (dpadBtn === 14) { // D-Pad Left
				let newIndex = (this.keyboardHoveredCardIndex === null || this.keyboardHoveredCardIndex === undefined) ? 0 : Math.max(0, this.keyboardHoveredCardIndex - 1);
				this.hoverCardByGamepad(newIndex);
			}
			else if (dpadBtn === 15) { // D-Pad Right
				let newIndex = (this.keyboardHoveredCardIndex === null || this.keyboardHoveredCardIndex === undefined) ? 0 : Math.min(maxIndex, this.keyboardHoveredCardIndex + 1);
				this.hoverCardByGamepad(newIndex);
			}
			else if (dpadBtn === 12) { // D-Pad Up (Discard)
				if (this.keyboardHoveredCardIndex !== null && this.keyboardHoveredCardIndex !== undefined) {
					const index = this.keyboardHoveredCardIndex;
					this.keyboardHoveredCardIndex = null;
					this.cycleCard(this.turnPhase, index, null, true);
				}
			}
		}
	},

	// Helper function for D-Pad card hovering (remains the same)
	hoverCardByGamepad: function(index) {
		const cardEl = document.getElementById(`activity-card-${index}`);
		if (!cardEl) return;

		document.querySelectorAll('.card-sim-hover').forEach(el => el.classList.remove('card-sim-hover'));
		
		this.keyboardHoveredCardIndex = index;
		cardEl.classList.add('card-sim-hover');
		
		const spatialPan = this.turnPhase === 1 ? -0.6 : 0.6;
		if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan); 
	},
	
	loadAI: function(diff) {
        console.log(`Instructing Worker to fetch Brain for difficulty: ${diff}`);
        this.isAiReady = false; 
        this.aiWorker.postMessage({ type: 'LOAD', diff: diff });
    },
	
	handleAttackByKey: function(index) {
        const moveKey = this.playerLoadout[index];
        const p = this.turnPhase === 1 ? this.p1 : this.p2;
        // Check if player has enough momentum
        if (MOVES[moveKey] && p.mom >= MOVES[moveKey].cost) {
            this.submitMove(this.turnPhase, moveKey);
        }
    },
    
    scheduleHPGleam: function() {
        const nextTime = Math.random() * 4000 + 8000; // 8 to 12 seconds
        setTimeout(() => {
            this.triggerHPGleam();
            this.scheduleHPGleam();
        }, nextTime);
    },

    triggerHPGleam: function() {
        const p1 = document.getElementById('p1-hp-bar');
        const p2 = document.getElementById('p2-hp-bar');
        if(p1) {
            p1.classList.remove('gleaming');
            void p1.offsetWidth; // Trigger reflow
            p1.classList.add('gleaming');
        }
        if(p2) {
            p2.classList.remove('gleaming');
            void p2.offsetWidth;
            p2.classList.add('gleaming');
        }
    },
	
	jitterHPBar: function(pNum) {
        const bar = document.getElementById(`p${pNum}-hp-bar`);
        if (!bar) return;
        
        // Target the parent container so we don't interrupt the smooth width transition!
        const container = bar.parentElement; 
        
        container.classList.remove('hp-jitter-active');
        void container.offsetWidth; // Force reflow to instantly restart animation
        container.classList.add('hp-jitter-active');
        
        setTimeout(() => {
            container.classList.remove('hp-jitter-active');
        }, 200);
    },
	
	shatterMomentumPips: function(pNum, amount) {
        if (amount <= 0) return; // Safety check

        const track = document.getElementById(`p${pNum}-mom-track`);
        if (!track) return;

        // Grab all pips that are currently filled on the screen
        const filledPips = Array.from(track.querySelectorAll('.mom-pip.filled'));
        if (filledPips.length === 0) return;

        // Slice from the end of the array to only grab the ones we are losing
        const pipsToShatter = filledPips.slice(-amount);

        pipsToShatter.forEach(pip => {
            // 1. Instantly revert the physical pip to an empty outline container
            pip.classList.remove('p1', 'p2', 'filled');
            
            // 2. Create a temporary "ghost" fill to perform the explosion
            const fx = document.createElement('div');
            fx.className = 'pip-shatter-fx';
            
            // 3. Force the CSS to obey the global game speed multiplier!
            fx.style.animationDuration = `${0.5 * (this.timeMult || 1)}s`;
            
            // 4. Attach the explosion to the empty container
            pip.appendChild(fx);
        });
    },
	
	playerCosmetics: { mawashi: 'maw_default', skin: 'skin_default' },
    stableTab: 'mawashi',
    
	loadStats: function() {
		// --- THE VITAL FOUNDATION ---
		// Guarantee these exist before we do any merging, preventing TypeErrors for new players
		if (!this.stats) this.stats = {};
		if (!this.achievements) this.achievements = {};

		// 1. Load basic stats
		const saved = localStorage.getItem('sumo_stats');
		if (saved) {
			try { this.stats = { ...this.stats, ...JSON.parse(saved) }; } catch(e) {}
		}

		// 2. Load Career Data
		const careerSaved = localStorage.getItem('sumo_career');
		if (careerSaved) {
			try { 
				this.career = JSON.parse(careerSaved); 
			} catch(e) { console.error("Career load fail", e); }
		}

		// --- VITAL: THE "STRUCTURE GUARD" ---
		
		// Ensure career exists if completely fresh
		if (!this.career) this.career = {};
		
		if (this.career.bashoIndex === undefined) {
			this.career.bashoIndex = 0; 
		}

		// 3. ENSURE UNLOCKED MOVES EXISTS (The Source of Truth)
		if (!this.career.unlockedMoves || this.career.unlockedMoves.includes('harite')) { 
			this.career.unlockedMoves = ['strike', 'sweep', 'thrust', 'throw'];
		}
		
		if (!this.career.titles) this.career.titles = [];

		// 4. Initialize Sub-Objects
		if (!this.career.quickPlay) {
			this.career.quickPlay = {
				local: { wins: 0, played: 0 },
				online: { wins: 0, played: 0 },
				cpu_juryo: { wins: 0, played: 0 },
				cpu_maegashira: { wins: 0, played: 0 },
				cpu_ozeki: { wins: 0, played: 0 },
				cpu_yokozuna: { wins: 0, played: 0 }
			};
		}
		
		if (!this.career.style) {
			this.career.style = {
				success: { b: 0, a: 0, d: 0 },
				total: { b: 0, a: 0, d: 0 }
			};
		}

		if (!this.career.stats) {
			this.career.stats = { highestDiv: 0, bashosFinished:[0,0,0,0,0,0], bestRecordWins:[0,0,0,0,0,0], sanyakuMatches:{}, hoshoHistory: [] };
		}
        
		// Ensure the history array exists and has at least their starting baseline
		if (!this.career.stats.hoshoHistory) {
			this.career.stats.hoshoHistory = [];
		}
		if (this.career.stats.hoshoHistory.length === 0) {
			this.career.stats.hoshoHistory.push(this.career.hosho_kin || 1000);
		}

		// Guarantee Wallet Exists
		if (this.career.hosho_kin === undefined || isNaN(this.career.hosho_kin)) {
            this.career.hosho_kin = this.stats.hosho_kin || 0;
        }

		// 5. Load other bits (Achievements, Cosmetics, etc.)
		const achSaved = localStorage.getItem('sumo_achievements');
		if (achSaved) {
			try { 
				// Use the spread operator here too! It protects new achievements we add in updates
				this.achievements = { ...this.achievements, ...JSON.parse(achSaved) }; 
			} catch(e) {}
		}
		
		this.updateStableNotification();
	},

	saveLoadout: function() {
        // Save both the techniques AND the default momentum!
        const loadoutData = {
            moves: this.playerLoadout,
            momentum: this.playerBuildMom !== undefined ? this.playerBuildMom : 1
        };
        localStorage.setItem('sumo_loadout', JSON.stringify(loadoutData));
        this.pushToCloud();
    },
	
	loadLoadout: function() {
        const saved = localStorage.getItem('sumo_loadout');
        
        // --- NEW: Check if they have earned the 5th slot ---
        const hasKinboshi = this.achievements && this.achievements['kinboshi'];
        const expectedSlots = hasKinboshi ? 5 : 4;

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                
                if (Array.isArray(parsed)) {
                    this.playerLoadout = parsed;
                    this.playerBuildMom = 1; 
                } else {
                    this.playerLoadout = parsed.moves || ['strike', 'sweep', 'thrust', 'throw'];
                    this.playerBuildMom = parsed.momentum !== undefined ? parsed.momentum : 1;
                }
            } catch (e) {
                console.error("Loadout data corrupted, resetting to defaults.", e);
                this.playerLoadout = ['strike', 'sweep', 'thrust', 'throw'];
                this.playerBuildMom = 1;
            }
        } else {
            this.playerLoadout = ['strike', 'sweep', 'thrust', 'throw'];
            this.playerBuildMom = 1;
        }

        // --- NEW: Dynamically adjust array length based on prestige ---
        if (this.playerLoadout.length < expectedSlots) {
            // 1. Define a list of safe, basic moves to draw from
            const fallbackPool = ['strike', 'sweep', 'thrust', 'throw', 'trip', 'push'];
            
            // 2. Fill missing slots with unique moves
            while (this.playerLoadout.length < expectedSlots) {
                const uniqueMove = fallbackPool.find(move => !this.playerLoadout.includes(move)) || 'strike';
                this.playerLoadout.push(uniqueMove);
            }
            
            // 3. Sort them properly by cost! (Using optional chaining just to be safe)
            if (typeof window !== 'undefined' && window.MOVES) {
                this.playerLoadout.sort((a, b) => (MOVES[a]?.cost || 0) - (MOVES[b]?.cost || 0));
            }
            
        } else if (this.playerLoadout.length > expectedSlots) {
            // Failsafe trimming
            this.playerLoadout.length = expectedSlots; 
        }

        // --- NEW: Map exactly how many moves the player has dynamically ---
        this.p1.attacks = this.playerLoadout.map(moveKey => ({ id: moveKey }));
    },
	
	saveCosmetics: function() {
        localStorage.setItem('sumo_cosmetics', JSON.stringify(this.playerCosmetics));
		this.pushToCloud();
	},
	
	loadCosmetics: function() {
        const saved = localStorage.getItem('sumo_cosmetics');
        if (saved) {
            // 1. Pull the saved object out of local storage
            this.playerCosmetics = JSON.parse(saved);
            
            // 2. Apply those saved cosmetics to Player 1's active state
            if (this.playerCosmetics.skin) this.p1.skin = this.playerCosmetics.skin;
            if (this.playerCosmetics.mawashi) this.p1.mawashi = this.playerCosmetics.mawashi;
        }
    },
	
	migrateStatsToCareer: function() {
		// 1. Safety check: If career.quickPlay already exists, we've likely already migrated.
		if (this.career.quickPlay) return;

		console.log("🌸 Migrating legacy stats to Career Records...");

		// 2. Initialize the new containers in Career if they don't exist
		this.career.quickPlay = {
			local: { wins: this.stats.local_wins || 0, played: this.stats.local_played || 0 },
			online: { wins: this.stats.online_wins || 0, played: this.stats.online_played || 0 },
			cpu_juryo: { wins: this.stats.cpu_juryo_wins || 0, played: this.stats.cpu_juryo_played || 0 },
			cpu_maegashira: { wins: this.stats.cpu_maegashira_wins || 0, played: this.stats.cpu_maegashira_played || 0 },
			cpu_ozeki: { wins: this.stats.cpu_ozeki_wins || 0, played: this.stats.cpu_ozeki_played || 0 },
			cpu_yokozuna: { wins: this.stats.cpu_yokozuna_wins || 0, played: this.stats.cpu_yokozuna_played || 0 }
		};

		// 3. Move the currency
		this.career.hosho_kin = this.stats.hosho_kin || 0;

		// 4. Move the Style Analysis (Ternary Plot data)
		this.career.style = {
			success: { b: this.stats.style_b || 0, a: this.stats.style_a || 0, d: this.stats.style_d || 0 },
			total: { b: this.stats.total_b || 0, a: this.stats.total_a || 0, d: this.stats.total_d || 0 }
		};

		// 5. Clean up the old stats object so we don't have duplicate data
		// We keep 'total_matches' as a general counter, but remove the redundant wins/losses
		delete this.stats.local_wins;
		delete this.stats.online_wins;
		delete this.stats.hosho_kin;
		// ... etc

		this.saveCareer();
		this.saveStats();
		console.log("✅ Migration complete. Your spirit is unified!");
	},
    
    saveStats: function() {
        localStorage.setItem('sumo_stats', JSON.stringify(this.stats));
        localStorage.setItem('sumo_achievements', JSON.stringify(this.achievements));
		this.pushToCloud();
    },
	
	resetCareer: function() {
        this.career = {
            unlockedDiv: 0,
            activeBasho: null,
            titles: [],
            stats: {
                highestDiv: 0,
                bashosFinished: [0, 0, 0, 0, 0, 0],
                bestRecordWins: [0, 0, 0, 0, 0, 0],
                sanyakuMatches: { "Komusubi": 0, "Sekiwake": 0, "Ozeki": 0, "Yokozuna": 0 }
            },
			bashoIndex: 0
        };
        this.saveCareer();
    },
	
	/* --- GOOGLE CLOUD SYNC --- */
    
    googleSignIn: function() {
        auth.signInWithPopup(googleProvider)
            .then((result) => {
                this.log(`<span style="color:var(--gold);">Successfully linked to ${result.user.displayName}!</span>`);
                // The onAuthStateChanged listener above will automatically catch this and pull data
                
                // Update your UI (we'll need to add a visual indicator later)
                this.showRecords(); 
            })
            .catch((error) => {
                console.error("Login Failed:", error);
                this.log(`<span style="color:var(--accent-red);">Connection failed.</span>`);
            });
    },

    pushToCloud: function() {
        // Only attempt to save to cloud if the user is actually logged in
        if (!currentUserUID) return;
		
		const timestamp = Date.now();

        // Bundle all the fragmented local storage drawers into one master object
        const masterSave = {
            stats: this.stats,
            career: this.career,
            achievements: this.achievements,
            loadout: this.playerLoadout,
            cosmetics: this.playerCosmetics,
            lastUpdated: timestamp
        };
		
		// Save it locally so the game knows when we last pushed!
		localStorage.setItem('sumo_last_sync', timestamp);

        // Push to Firestore under their specific User ID
        db.collection("users").doc(currentUserUID).set(masterSave)
            .then(() => console.log("☁️ Save data secured in the cloud."))
            .catch(err => console.error("Cloud save failed:", err));
    },

	pullFromCloud: function() {
        if (!currentUserUID) return;

        db.collection("users").doc(currentUserUID).get()
            .then((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    
                    // --- THE NEW LOGIC: Timestamp Comparison ---
                    // Grab our local timestamp, or default to 0 if it doesn't exist yet
                    const localTimestamp = localStorage.getItem('sumo_last_sync') || 0;

                    if (data.lastUpdated && data.lastUpdated > localTimestamp) {
                        // The Cloud is newer! Download everything.
                        
                        // 1. Overwrite LocalStorage with the Cloud Data
                        if (data.stats) localStorage.setItem('sumo_stats', JSON.stringify(data.stats));
                        if (data.career) localStorage.setItem('sumo_career', JSON.stringify(data.career));
                        if (data.achievements) localStorage.setItem('sumo_achievements', JSON.stringify(data.achievements));
                        if (data.loadout) localStorage.setItem('sumo_loadout', JSON.stringify(data.loadout));
                        if (data.cosmetics) localStorage.setItem('sumo_cosmetics', JSON.stringify(data.cosmetics));
                        
                        // NEW: Update our local sync timestamp to match the cloud
                        localStorage.setItem('sumo_last_sync', data.lastUpdated);
                        
                        // 2. Force the game to reload these fresh stats into memory
                        this.loadStats();
                        this.loadLoadout();
                        this.loadCosmetics();
                        
                        console.log("☁️ Save data downloaded and applied!");
                        this.log(`<span style="color:var(--gold);">Save Data Synchronized!</span>`);
                        
                        // Refresh the screen if they are currently looking at Records or Stable
                        if (!document.getElementById('records-overlay').classList.contains('hidden')) {
                            this.showRecords();
                        }
                    } else {
                        // The Local data is newer (or they are perfectly synced).
                        // Instead of downloading old data, let's push our fresh local data up!
                        console.log("Local data is newer or identical. Pushing to cloud...");
                        this.pushToCloud();
                    }
                    // -------------------------------------------

                } else {
                    // No cloud save exists yet, so push their current local progress up to start it!
                    console.log("No cloud save found. Creating new cloud profile...");
                    this.pushToCloud();
                }
            })
            .catch(err => console.error("Error pulling from cloud:", err));
    },
    
	unlockAchievement: function(key) {
        if (this.isTutorial) return; 

        // 1. CRITICAL FIX: Check if we already have this achievement FIRST.
        // If we do, stop immediately. Do not mark as unseen.
        if (this.achievements[key]) return;

        // 2. Logic for TRULY new items starts here
        this.achievements[key] = true; // Mark as owned immediately
        this.saveStats();

        // 3. Mark as Unseen/New for the UI
        this.hasNewUnlocks = true;
        this.unseenItemIds.add(key);

        const item = Object.values(COSMETICS).find(c => c.req === key);
        if (item) {
            this.newUnlocksByCategory[item.type] = true;
        }
        
        this.updateStableNotification();

        // 4. Queue the notification popup
        this.refreshNewCategoryFlags();
        this.achievementQueue.push(key);
        this.processAchievementQueue();
    },
	
	updateStableNotification: function() {
		const btn = document.querySelector('.heya-btn');
		if (!btn) return;
		
		this.hasNewUnlocks = (
			this.newUnlocksByCategory.mawashi || 
			this.newUnlocksByCategory.skin || 
			this.newUnlocksByCategory.tech ||
			this.newUnlocksByCategory.dohyo ||
			this.newUnlocksByCategory.deck // <-- Added Deck check!
		);

		const label = btn.querySelector('.heya-label');

		if (this.hasNewUnlocks) {
			btn.classList.add('stable-notification');
		} else {
			btn.classList.remove('stable-notification');
			if (label) {
				label.innerText = "STABLE";
				label.style.color = ""; 
			}
		}
	},

	updateTabIndicators: function() {
		const mTab = document.getElementById('tab-mawashi');
		const sTab = document.getElementById('tab-skin');
		const dTab = document.getElementById('tab-dohyo');
		const tTab = document.getElementById('tab-tech');

		if (mTab) mTab.classList.toggle('tab-new-dot', !!this.newUnlocksByCategory.mawashi);
		if (sTab) sTab.classList.toggle('tab-new-dot', !!this.newUnlocksByCategory.skin);
		if (dTab) dTab.classList.toggle('tab-new-dot', !!this.newUnlocksByCategory.dohyo);
		
		// The Tech tab illuminates if there are new attacks OR new deck cards!
		if (tTab) tTab.classList.toggle('tab-new-dot', !!(this.newUnlocksByCategory.tech || this.newUnlocksByCategory.deck));
	},

	checkDivisionUnlocks: function(finishedDivIndex) {
        // CORRECT KEYS matching your MOVES object
        const unlockMap = {
            0: { move: 'hook',   badge: 'master_jonokuchi' },
            1: { move: 'crush',  badge: 'master_jonidan' },
            2: { move: 'trip',   badge: 'master_sandanme' },
            3: { move: 'twist',  badge: 'master_makushita' },
            4: { move: 'nodowa', badge: 'master_juryo' },
            5: { move: 'utchari', badge: 'master_makuuchi' }
        };

        const reward = unlockMap[finishedDivIndex];
        if (!reward) return;

        // CRITICAL FIX: Only flag the Move as "New" if we didn't have it before.
        // Previously, getting 8 wins (Kachi-Koshi) in a rank you already beat would re-flag the move.
        if (!this.career.unlockedMoves.includes(reward.move)) {
            this.career.unlockedMoves.push(reward.move);
            
            // Mark the MOVE as new/unseen
            this.newUnlocksByCategory.tech = true;
            this.hasNewUnlocks = true;
            this.unseenItemIds.add(reward.move);

            const moveName = MOVES[reward.move] ? MOVES[reward.move].name : reward.move;
            this.log(`<span style="color:var(--gold); font-weight:bold;">✨ NEW TECHNIQUE UNLOCKED: ${moveName.toUpperCase()}!</span>`);
            
            this.saveCareer();
            this.updateStableNotification();
        }

        // Attempt to unlock the badge (The function above now handles the "duplicate check" safety)
        this.unlockAchievement(reward.badge);
    },
	
	processAchievementQueue: function() {
		// If we are already showing a badge, or the queue is empty, stop.
		if (this.isNotifying || this.achievementQueue.length === 0) return;

		this.isNotifying = true;
		const key = this.achievementQueue.shift(); // Get the oldest achievement
		this.showAchievementNotification(key);
	},

    showAchievementNotification: function(key) {
		const data = BADGES[key];
		const overlay = document.getElementById('achievement-overlay');
    
		if (data && overlay) {
			document.getElementById('ach-title').innerText = data.title;
			document.getElementById('ach-desc').innerText = data.desc;
			document.getElementById('ach-icon').innerText = data.icon;
        
			overlay.classList.remove('hidden');
			// Measure the height the browser just calculated
			const finalHeight = overlay.offsetHeight;
			// Lock it in so it cannot "jiggle" when we add the hidden class later
			overlay.style.height = finalHeight + 'px';
			sound.play('achievement');
        
			// Wait for the notification to finish (5 seconds)
			setTimeout(() => {
				overlay.classList.add('hidden');
            
				// Wait for the CSS fade-out to finish (approx 500ms) 
				// before starting the next one.
				setTimeout(() => {
					this.isNotifying = false;
					overlay.style.height = 'auto';
					// NOW it is safe to clear the text because the box is visibility: hidden
					document.getElementById('ach-title').innerText = "";
					document.getElementById('ach-desc').innerText = "";
					
					this.processAchievementQueue(); // Check for more!
				}, 600); 
            
			}, 5000);
		} else {
			// Fallback if elements are missing
			this.isNotifying = false;
			this.processAchievementQueue();
		}
	},
	
	checkProgressiveAchievements: function(isWin) {
		const s = this.career.stats || {};
		const qp = this.career.quickPlay || {};

		// --- THE FIX: Robust Aggregation that catches ALL old and new keys ---
		let totalMatches = (qp.local?.played || 0) + (qp.online?.played || 0);
		let totalWins = (qp.local?.wins || 0) + (qp.online?.wins || 0);

		Object.keys(qp).forEach(k => {
			if (k.startsWith('cpu_') || k.startsWith('div_')) {
				totalMatches += (qp[k]?.played || 0);
				totalWins += (qp[k]?.wins || 0);
			}
		});

		const builds = this.stats.total_build_actions || 0;
		const damageTaken = this.stats.total_damage_taken || 0;
		const lossStreak = this.stats.loss_streak || 0;
		
		// --- DEBUG READOUT ---
		console.group("🛠️ Progressive Achievements Triggered");
		console.table({
			"Total Matches": totalMatches,
			"Total Wins": totalWins,
			"Total Builds": builds,
			"Damage Taken": damageTaken,
			"Loss Streak": lossStreak,
			"Was Match Won?": isWin
		});
		console.groupEnd();

		// 2. CHECK MATCH MILESTONES
		if (totalMatches >= 10) this.unlockAchievement('dohyo_iri');
		if (totalMatches >= 25) this.unlockAchievement('rikishi');
		if (totalMatches >= 50) this.unlockAchievement('sekitori');
		if (totalMatches >= 100) this.unlockAchievement('oyakata');

		// 3. CHECK MOMENTUM MILESTONES
		if (builds >= 50) this.unlockAchievement('teppo');
		if (builds >= 100) this.unlockAchievement('matawari');
		if (builds >= 200) this.unlockAchievement('sonkyo');
		if (builds >= 500) this.unlockAchievement('tamashii');

		// 4. CHECK WIN MILESTONES
		if (totalWins >= 10) this.unlockAchievement('kachi_koshi');
		if (totalWins >= 50) this.unlockAchievement('yusho');

		// 5. STREAKS (Win/Loss)
		if (this.career.stats.loss_streak >= 5) this.unlockAchievement('make_koshi');
		if (this.career.stats.loss_streak >= 10) this.unlockAchievement('gaman');
		
		// Salt Toss: 5 matches played, 0 wins in last 5 (Calculated via streak)
		if (this.career.stats.loss_streak >= 5) this.unlockAchievement('salt_toss');

		// 6. DAMAGE TAKEN
		if (damageTaken >= 500) this.unlockAchievement('butsukari');
	},
	
	showRecords: function() {
		Object.keys(BADGES).forEach(badgeId => this.unseenItemIds.delete(badgeId));
		this.refreshNewCategoryFlags(); // Update the main menu button
		this.hideOverlays();
		this.loadStats();
		
		const overlay = document.getElementById('records-overlay');
		const content = document.getElementById('records-content');
		if (!overlay || !content) return;

		overlay.classList.remove('hidden');
		
		// --- DATA REFERENCES ---
		const c = this.career;
		const cs = c.stats || { highestDiv: 0, bashosFinished:[0,0,0,0,0,0], bestRecordWins:[0,0,0,0,0,0], sanyakuMatches:{} };
		const qp = c.quickPlay || { local:{wins:0, played:0}, online:{wins:0, played:0}, cpu_juryo:{wins:0, played:0}, cpu_ozeki:{wins:0, played:0} };

		// --- 1. INJECT RESPONSIVE CSS ---
		const styleTag = document.createElement('style');
		styleTag.innerHTML = `
			/* BASE WINDOW STYLES (The Frame) */
			.banzuke-window {
				background: var(--bg-color, #f4ecd8) url('https://www.transparenttextures.com/patterns/handmade-paper.png');
				border: 8px double var(--ink-color, #2c2c2c);
				border-radius: 6px;
				box-shadow: 0 15px 40px rgba(0,0,0,0.6), inset 0 0 60px rgba(74, 55, 40, 0.15);
				width: 900px;
				max-width: 95vw;
				height: auto;
				max-height: 92dvh; /* THE FIX: Respects mobile URL bars */
				margin: auto;
				position: relative;
				color: var(--ink-color, #2c2c2c);
				font-family: var(--font-main, 'Georgia', serif);
				display: flex;
				flex-direction: column;
				overflow: hidden; /* Keeps the border clean */
			}

			/* THE SCROLLABLE INTERIOR */
			.banzuke-scroll-body {
				flex: 1;
				overflow-y: auto;
				padding: 20px 30px 30px 30px;
				display: flex;
				flex-direction: column;
				gap: 30px; /* Generous breathing room between sections */
			}

			.banzuke-scroll-body::-webkit-scrollbar { width: 8px; }
			.banzuke-scroll-body::-webkit-scrollbar-thumb { background: var(--ink-color, #4a3728); border-radius: 4px; }
			.banzuke-scroll-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }

			/* HEADER */
			.banzuke-header {
				flex: 0 0 auto;
				text-align: center;
				padding: 15px 20px 10px 20px;
				border-bottom: 2px solid var(--accent-red, #8b0000);
				background: rgba(255,255,255,0.3);
			}

			/* DASHBOARD GRIDS */
			.records-profile-section {
				display: grid;
				grid-template-columns: 200px 1fr;
				gap: 25px;
				align-items: center;
				background: rgba(0,0,0,0.03);
				padding: 20px;
				border-radius: 12px;
				border: 1px solid rgba(0,0,0,0.1);
			}

			.records-stats-section {
				display: grid;
				grid-template-columns: 1.5fr 1fr; /* Graph takes more space than Ternary */
				gap: 20px;
				align-items: stretch;
			}

			/* SECTION HEADERS */
			.section-title {
				font-size: 0.85rem;
				color: var(--ink-color, #4a3728);
				border-bottom: 1px dashed rgba(0,0,0,0.2);
				margin-bottom: 15px;
				padding-bottom: 5px;
				text-transform: uppercase;
				letter-spacing: 2px;
				font-weight: bold;
			}

			/* DATA TABLES */
			.basho-table {
				width: 100%;
				text-align: left;
				font-size: 0.85rem;
				border-collapse: collapse;
			}
			.basho-table th { padding: 8px 5px; background: rgba(0,0,0,0.05); }
			.basho-table td { padding: 8px 5px; border-bottom: 1px solid rgba(0,0,0,0.05); }
			.basho-table tr:hover { background: rgba(255,255,255,0.5); }

			/* MOBILE OVERRIDES */
			@media (max-width: 768px) {
				.records-profile-section, 
				.records-stats-section {
					grid-template-columns: 1fr;
				}
				.records-profile-section { text-align: center; justify-items: center; }
				.banzuke-scroll-body { padding: 15px; gap: 20px; }
				.close-btn-top { display: none; }
			}

			/* TOGGLES */
			.active-toggle { background: var(--ink-color, #4a3728); color: #fff; }
			.inactive-toggle { background: transparent; color: var(--ink-color, #4a3728); }
			
			/* ANIMATIONS */
			@keyframes topknotReveal {
				from { opacity: 0; transform: scale(0.8) translateY(10px); }
				to { opacity: 1; transform: scale(1) translateY(0); }
			}
		`;

		content.className = 'banzuke-window';
		content.innerHTML = ''; 
		content.appendChild(styleTag);

		const hairData = this.getExpAndHair();
		
		const maxExp = OICHOMAGE_EXP;
		const currentExp = Math.min(hairData.exp || 0, maxExp);
		const progressPct = currentExp / maxExp; 
		const isMax = currentExp >= maxExp; 
		const hasTsuyamage = currentExp >= TSUYAMAGE_EXP && !isMax; 
		const hasChonmage = currentExp >= OCHOMAGE_EXP && !hasTsuyamage && !isMax; 
		const hasMage = currentExp >= MAGE_EXP && !hasChonmage && !hasTsuyamage && !isMax;
		
		let flavorText = "As each strand grows, so too does your knowledge and ability.";
		if (hasMage) flavorText = "The Mage is bound. Your expanding repertoire demands more resolve.";
		if (hasChonmage) flavorText = "The Chonmage is tied. You are now a battle-tested Rikishi.";
		if (hasTsuyamage) flavorText = "The scent of bintsuke oil is heavy. You are on the cusp of true greatness."; 
		if (isMax) flavorText = "The Ginkgo leaf is set. You have reached the pinnacle of the Tokoyama's art.";

		const clipHeight = 100 + (progressPct * 150);

		let banzukeName = "Sumo";
		if (typeof auth !== 'undefined' && auth.currentUser) {
			if (auth.currentUser.displayName) {
				banzukeName = auth.currentUser.displayName.split(' ')[0] + "'s";
			} else if (typeof currentUserUID !== 'undefined' && currentUserUID) {
				banzukeName = "Guest Rikishi's";
			}
		}

		let html = `
			<div class="banzuke-header">
				<button class="close-btn close-btn-top" 
					style="position: absolute; top: 15px; right: 15px; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--ink-color); opacity: 0.6; font-weight: bold;" 
					onclick="game.backToTitle()">✕</button>
				<h2 style="font-family: var(--font-title); color: var(--accent-red); margin: 0; letter-spacing: 3px; font-size: 1.5rem; text-transform: uppercase;">
					${banzukeName} Career
				</h2>
			</div>

			<div class="banzuke-scroll-body">
				
				<div class="records-profile-section">
					<div style="width: 160px; height: 180px; border-radius: 50% 50% 10px 10px; background: #fff; border: 3px solid rgba(74, 55, 40, 0.2); overflow: hidden; display: flex; justify-content: center; align-items: flex-end; box-shadow: 0 4px 15px rgba(0,0,0,0.1); position: relative;">
						<svg viewBox="0 0 200 250" width="100%" height="100%" style="display: block;">
							<defs>
								<clipPath id="hairProgress">
									<rect x="0" y="0" width="200" height="100">
										<animate attributeName="height" from="100" to="${clipHeight}" dur="1.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.45 0.05 0.55 0.95" />
									</rect>
								</clipPath>
								<linearGradient id="pearlSkin" x1="0%" y1="0%" x2="100%" y2="0%">
									<stop offset="0%" stop-color="#ffffff" /><stop offset="50%" stop-color="#f8f8f8" /><stop offset="100%" stop-color="#e8e8e8" />
								</linearGradient>
								<linearGradient id="hairSheen" x1="0%" y1="0%" x2="100%" y2="0%">
									<stop offset="0%" stop-color="#050505" /><stop offset="25%" stop-color="#222" /><stop offset="50%" stop-color="#333" /><stop offset="75%" stop-color="#222" /><stop offset="100%" stop-color="#050505" />
								</linearGradient>
							</defs>

							<g clip-path="url(#hairProgress)">
								<path d="M 50 100 C 5 160 15 230 30 260 L 170 260 C 185 230 195 160 150 100 Z" fill="url(#hairSheen)"/>
							</g>

							<path d="M 20 260 C 20 180 70 160 100 160 C 130 160 180 180 180 260 Z" fill="url(#pearlSkin)" stroke="#aaa" stroke-width="1.5"/>
							<rect x="85" y="135" width="30" height="35" fill="url(#pearlSkin)" stroke="#aaa" stroke-width="1.5"/>
							<ellipse cx="58" cy="115" rx="6" ry="12" fill="url(#pearlSkin)" stroke="#aaa" stroke-width="1.5"/>
							<ellipse cx="142" cy="115" rx="6" ry="12" fill="url(#pearlSkin)" stroke="#aaa" stroke-width="1.5"/>
							<path d="M 60 100 C 60 45 140 45 140 100 C 140 155 60 155 60 100 Z" fill="url(#pearlSkin)" stroke="#aaa" stroke-width="1.5"/>
							<path d="M 59 100 C 55 50 145 50 141 100 C 141 75 59 75 59 100 Z" fill="url(#hairSheen)"/>

							<g clip-path="url(#hairProgress)">
								<path d="M 65 100 C 45 155 85 200 65 255" stroke="url(#hairSheen)" stroke-width="12" stroke-linecap="round" fill="none"/>
								<path d="M 135 100 C 155 155 115 200 135 255" stroke="url(#hairSheen)" stroke-width="12" stroke-linecap="round" fill="none"/>
								<path d="M 67 110 C 50 155 87 200 67 245" stroke="rgba(255,255,255,0.1)" stroke-width="2" fill="none"/>
							</g>

							${(hasChonmage || hasTsuyamage) ? `
							<g style="opacity: 0; animation: topknotReveal 1s ease-out 1.2s forwards;">
								<ellipse cx="100" cy="48" rx="18" ry="11" fill="url(#hairSheen)" />
								<path d="M 90 48 Q 100 40 110 48" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/>
							</g>` : ''}

							${isMax ? `
							<g style="opacity: 0; animation: topknotReveal 1s ease-out 1.2s forwards;">
								<ellipse cx="100" cy="45" rx="24" ry="14" fill="url(#hairSheen)" />
								<path d="M 85 45 L 100 32 L 115 45" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none"/>
							</g>` : ''}
						</svg>
						${isMax ? `<div style="position:absolute; bottom:5px; background:var(--accent-red); color:white; font-size:0.6rem; font-weight:bold; padding:2px 8px; border-radius:10px; letter-spacing:1px;">MASTERED</div>` : ''}
					</div>

					<div style="display: flex; flex-direction: column; gap: 10px;">
						<div>
							<div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 3px; color: #888;">Mage-yui • 髪結い</div>
							<div style="font-size: 1.8rem; font-family: var(--font-title); font-weight: bold; color: var(--ink-color); line-height: 1.1;">${hairData.title}</div>
							<div style="font-size: 0.8rem; color: #666; font-style: italic; margin-top: 5px;">${flavorText}</div>
						</div>

						<div style="display: flex; gap: 15px; align-items: center; margin-top: 10px;">
							<div style="background: #fff; padding: 10px 15px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; flex: 1; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
								<div style="font-size: 0.7rem; text-transform: uppercase; color: #888;">Current Rank</div>
								<div style="font-size: 1.2rem; font-weight: bold; color: var(--accent-red);">${this.DIVISIONS[c.unlockedDiv].name}</div>
							</div>
							
							<button onclick="game.googleSignIn()" title="Sync with Google" style="width: 50px; height: 50px; border: 1px solid rgba(0,0,0,0.1); background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48">
									<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
									<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
									<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
									<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
								</svg>
							</button>
						</div>
					</div>
				</div>

				<div class="records-stats-section">
					<div style="display: flex; flex-direction: column;">
						<div style="display: flex; justify-content: space-between; align-items: baseline;">
							<div class="section-title">Career Earnings</div>
							<span style="font-size: 1.1rem; color: var(--gold); font-weight: bold;">${c.hosho_kin || 0}¥</span>
						</div>
						<div id="hosho-graph-container" style="flex: 1; min-height: 120px; background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; position: relative; overflow: hidden;"></div>
						
						<div style="margin-top: 15px; background: rgba(255,255,255,0.4); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 10px;">
							<table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
								<tr style="border-bottom: 1px dashed rgba(0,0,0,0.1);"><td style="padding:4px 0;">Local Matches</td><td align="right"><b>${qp.local.wins}</b> / ${qp.local.played}</td></tr>
								<tr><td style="padding:4px 0;">Online Matches</td><td align="right"><b>${qp.online.wins}</b> / ${qp.online.played}</td></tr>
							</table>
						</div>
					</div>

					<div style="display: flex; flex-direction: column; background: rgba(255,255,255,0.4); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 15px; align-items: center;">
						<div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
							<span style="font-size: 0.8rem; font-weight: bold; color: var(--ink-color);">STYLE ANALYSIS</span>
							<div style="display: flex;">
								<button onclick="game.setRecordStatMode('success')" class="${this.currentRecordStatMode !== 'total' ? 'active-toggle' : 'inactive-toggle'}" style="font-size: 0.65rem; padding: 4px 8px; cursor: pointer; border: 1px solid var(--ink-color); border-right: none; border-radius: 4px 0 0 4px;">SUCCESS</button>
								<button onclick="game.setRecordStatMode('total')" class="${this.currentRecordStatMode === 'total' ? 'active-toggle' : 'inactive-toggle'}" style="font-size: 0.65rem; padding: 4px 8px; cursor: pointer; border: 1px solid var(--ink-color); border-radius: 0 4px 4px 0;">ATTEMPTS</button>
							</div>
						</div>
						<div style="flex: 1; display: flex; align-items: center;">
							<svg id="ternary-svg" width="200" height="150" viewBox="0 0 220 200" style="overflow: visible;">
								<polygon points="110,10 10,183 210,183" fill="rgba(255,255,255,0.7)" stroke="var(--ink-color)" stroke-width="1.5"/>
								<text x="110" y="-5" text-anchor="middle" font-size="11" fill="var(--accent-red)" font-weight="bold" style="font-family:serif;">BUILD</text>
								<text x="-10" y="195" text-anchor="start" font-size="11" fill="var(--ink-color)" font-weight="bold" style="font-family:serif;">DEFEND</text>
								<text x="230" y="195" text-anchor="end" font-size="11" fill="var(--ink-color)" font-weight="bold" style="font-family:serif;">ATTACK</text>
								<circle id="record-style-dot" cx="110" cy="115" r="7" fill="var(--accent-red)" stroke="white" stroke-width="2" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));"/>
							</svg>
						</div>
					</div>
				</div>

				<div>
					<div class="section-title">Bashō History</div>
					<div style="background: rgba(255,255,255,0.4); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden;">
						<table class="basho-table">
							<tr style="background: rgba(0,0,0,0.08); font-weight: bold;">
								<th>Division</th><th style="text-align:center;">Tournaments</th><th style="text-align:right;">Best Record</th>
							</tr>`;

				this.DIVISIONS.forEach((div, idx) => {
					if (cs.bashosFinished[idx] > 0 || idx <= cs.highestDiv) {
						const wins = cs.bestRecordWins[idx];
						const isCurrent = idx === c.unlockedDiv;
						const rowStyle = isCurrent ? 'color: var(--accent-red); font-weight:bold; background:rgba(217,58,58,0.05);' : '';
						const totalMatches = idx < 4 ? 7 : 15; 
						const losses = totalMatches - wins;
						
						html += `
							<tr style="${rowStyle}">
								<td>${div.name}</td>
								<td style="text-align:center;">${cs.bashosFinished[idx]}</td>
								<td style="text-align:right;">${wins > 0 ? wins + '-' + losses : '--'}</td>
							</tr>`;
					}
				});

		html += `
						</table>
					</div>
				</div>

				<div>
					<div class="section-title">Honors</div>
					<div id="honors-container" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-start; background: rgba(255,255,255,0.4); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 15px;">
						</div>
				</div>

			</div> <div style="flex: 0 0 auto; text-align: center; padding: 15px; background: rgba(0,0,0,0.02); border-top: 1px solid rgba(0,0,0,0.05);">
				<button class="menu-btn" onclick="game.backToTitle()" 
					style="padding: 12px 40px; border: 2px solid var(--ink-color); background: var(--accent-red); color: #fff; font-family: var(--font-title); font-size: 1rem; cursor: pointer; border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
					RETURN TO STABLE
				</button>
			</div>
		`;

		const containerDiv = document.createElement('div');
		containerDiv.innerHTML = html;
		
		while (containerDiv.firstChild) {
			content.appendChild(containerDiv.firstChild);
		}

		this.drawRecordTernaryPlot();
		this.drawHoshoGraph();
		this.renderBadges();
	},
	
	drawHoshoGraph: function() {
		const container = document.getElementById('hosho-graph-container');
		if (!container) return;
		
		let history = this.career.stats?.hoshoHistory;
		if (!history || history.length === 0) {
			history = [this.career.hosho_kin || 1000];
		}

		// Cap the visual rendering to the most recent 50 matches for aesthetic clarity
		const displayData = history.slice(-50); 
		
		// If only one data point exists, duplicate it so a flat line renders correctly
		if (displayData.length === 1) displayData.push(displayData[0]);

		const width = 400;
		const height = 100;
		const padding = 15;

		const minVal = Math.min(...displayData);
		const maxVal = Math.max(...displayData);
		// Ensure a minimum vertical scale so a completely flat history still centers
		const range = Math.max(maxVal - minVal, 100); 

		// Map array values to X/Y coordinates
		let points = displayData.map((val, index) => {
			const x = padding + (index / (displayData.length - 1)) * (width - padding * 2);
			const y = height - padding - ((val - minVal) / range) * (height - padding * 2);
			return `${x},${y}`;
		}).join(' ');

		// Create a closed polygon for the gold gradient fade
		const firstX = padding;
		const lastX = width - padding;
		const fillPoints = `${firstX},${height} ${points} ${lastX},${height}`;

		const svg = `
			<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none" style="display: block;">
				<defs>
					<linearGradient id="hoshoGradient" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stop-color="#b8860b" stop-opacity="0.4"/>
						<stop offset="100%" stop-color="#b8860b" stop-opacity="0.0"/>
					</linearGradient>
				</defs>
				
				<line x1="0" y1="${padding}" x2="${width}" y2="${padding}" stroke="rgba(74, 55, 40, 0.1)" stroke-dasharray="4 4" />
				<line x1="0" y1="${height - padding}" x2="${width}" y2="${height - padding}" stroke="rgba(74, 55, 40, 0.1)" stroke-dasharray="4 4" />
				
				<polygon points="${fillPoints}" fill="url(#hoshoGradient)" />
				
				<polyline points="${points}" fill="none" stroke="#b8860b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 3px rgba(184, 134, 11, 0.3));" />
				
				<circle cx="${width - padding}" cy="${height - padding - ((displayData[displayData.length - 1] - minVal) / range) * (height - padding * 2)}" r="4.5" fill="#8b0000" stroke="#fff" stroke-width="1.5" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,0.4));" />
			</svg>
		`;
		
		container.innerHTML = svg;
	},

	drawRecordTernaryPlot: function() {
		const dot = document.getElementById('record-style-dot');
		if (!dot || !this.career.style) return;

		// --- PREMIUM ANIMATION CONFIG ---
		// Using a 'Back Out' effect (0.34, 1.56, 0.64, 1) gives it a slight, classy bounce
		dot.style.transition = "cx 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), cy 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)";
		
		const styleData = this.career.style;
		const mode = this.currentRecordStatMode || 'success';
		
		let b, d, a;
		if (mode === 'total') {
			b = styleData.total.b || 0;
			d = styleData.total.d || 0;
			a = styleData.total.a || 0;
		} else {
			b = styleData.success.b || 0;
			d = styleData.success.d || 0;
			a = styleData.success.a || 0;
		}

		const total = b + d + a;

		// Neutral center if no data
		if (total === 0) {
			dot.setAttribute('cx', 110);
			dot.setAttribute('cy', 115);
			return;
		}

		// Normalizing ratios
		const pb = b / total;
		const pd = d / total;
		const pa = a / total;

		// Triangle Coordinate Mapping
		const targetX = (pb * 110) + (pd * 10) + (pa * 210);
		const targetY = (pb * 10) + (pd * 183) + (pa * 183);

		// Apply coordinates - the CSS transition handles the "sweep"
		dot.setAttribute('cx', targetX);
		dot.setAttribute('cy', targetY);
	},
	
	setRecordStatMode: function(mode) {
		this.currentRecordStatMode = mode;
		
		// Update button UI (if you add buttons to the records overlay)
		const btnS = document.getElementById('btn-record-success');
		const btnT = document.getElementById('btn-record-total');
		if (btnS && btnT) {
			btnS.classList.toggle('active', mode === 'success');
			btnT.classList.toggle('active', mode === 'total');
		}

		this.drawRecordTernaryPlot();
	},
    
   renderBadges: function() {
        // We look for the container. It might be on the main menu OR the records screen now.
        const container = document.getElementById('honors-container');
        if (!container) return; // Safety check

        container.innerHTML = '';
        
        // Define which badges deserve the "Gleam" effect from your CSS
        const gleamingBadges = ['kinboshi', 'zensho_streak', 'fudo_shin', 'sandan_gamae', 'mizu_iri'];

        const secretIDs = ['henka', 'dohyo_giwa', 'kadoban', 'hachinana', 
			'kaeshi_waza', 'hyōhyō', 'onibi', 'tobiuo', 
			'shinitai', 'salt_toss', 'perfect_balance', 'kinboshi','zensho_streak'];
		
        const badgeEntries = Object.entries(BADGES);
        const regularBadges = badgeEntries.filter(([key]) => !secretIDs.includes(key));
        const mysteryBadges = badgeEntries.filter(([key]) => secretIDs.includes(key));
        const sortedBadges = [...regularBadges, ...mysteryBadges];
        
        for (const [key, data] of sortedBadges) {
            const unlocked = this.achievements[key];
            const isSecret = secretIDs.includes(key) && !unlocked;
            
            const div = document.createElement('div');
            // Base classes
            div.className = `honor-badge ${unlocked ? 'unlocked' : (isSecret ? 'locked-secret' : 'locked-visible')}`;
            
            // RESTORED: Apply the gleaming-badge class if unlocked and in the list
            if (unlocked && gleamingBadges.includes(key)) {
                div.classList.add('gleaming-badge');
            }

            if (key === 'kinboshi' || key === 'rensho') div.setAttribute('data-special', key);
            const iconContent = (isSecret) ? '?' : data.icon;
			div.innerHTML = `<div class="shimmer-clip">${iconContent}</div>`;
            
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            
            if (isSecret) {
                tooltip.innerHTML = `<strong>???</strong><br>Keep playing to discover this honor.`;
            } else {
                let extraInfo = '';
                if (key === 'kimarite') {
                    const progress = this.career.stats.finishing_moves || [];
                    const moves = ['strike', 'sweep', 'thrust', 'throw'];
                    extraInfo = '<br><br><small>REQUIRED FINISHES:</small><br>';
                    moves.forEach(m => {
                        const hasIt = progress.includes(m);
                        extraInfo += `${hasIt ? '✅' : '❌'} ${MOVES[m].name}<br>`;
                    });
                }
                tooltip.innerHTML = `<strong>${data.title}</strong><br>${data.desc}${extraInfo}`;
            }
            
            div.appendChild(tooltip);
            container.appendChild(div);
        }
    },
	
	saveCareer: function() {
        localStorage.setItem('sumo_career', JSON.stringify(this.career));
		this.pushToCloud();
    },

    openCampaign: function() {
        const stage = document.getElementById('promotion-stage');
        if (stage) stage.innerHTML = '';
        
        // --- CLEANUP HERE ---
        const heyaBtn = document.getElementById('global-heya-btn');
        if (heyaBtn) heyaBtn.classList.remove('slide-in-bottom-left');
        document.getElementById('global-heya-btn').classList.add('hidden');
        if (this.crowdTimer) clearTimeout(this.crowdTimer);
        
        // 1. Force the dead bodies to stand up
        this.resetAvatars(true); 

        // 2. Remove the cinematic darkness and screen tear from the container
        const board = document.getElementById('game-board');
        board.classList.remove('cinematic-fatal', 'screen-tear');
        document.body.classList.remove('hit-stop', 'game-over-active');
        
        // Ensure the player has a tracker for the calendar (defaults to 0: January)
        if (typeof this.career.bashoIndex === 'undefined') {
            this.career.bashoIndex = 0;
        }

        // Grab the current seasonal data
        const currentSeason = this.BASHO_CALENDAR[this.career.bashoIndex];

        // Update the UI
        const monthText = document.getElementById('basho-month-text');
        const nameText = document.getElementById('basho-name-text');
        const kanjiText = document.getElementById('basho-kanji-text');

        if (monthText && nameText && kanjiText) {
            monthText.innerText = currentSeason.month;
            nameText.innerText = currentSeason.name;
            kanjiText.innerText = currentSeason.kanji;
        }
        
        // --- NEW: Toggle the Practice Button Glow ---
        const practiceBtn = document.getElementById('btn-practice'); 

        if (practiceBtn) {
            if (!this.career.practicedThisBasho) {
                // Experience is available! Add the glowing halo.
                practiceBtn.classList.add('stable-notification');
            } else {
                // They already practiced. Remove the glow.
                practiceBtn.classList.remove('stable-notification');
            }
        }
        
        this.hideOverlays();
        document.getElementById('campaign-screen').classList.remove('hidden');
        this.renderCampaignMenu();
		
		// 1. Check for Practice Minigame Loot
		if (this.practiceEarnedLoot !== undefined && this.practiceEarnedLoot !== null) {
			if (this.practiceEarnedLoot.length > 0) {
				this.renderLootUI(this.practiceEarnedLoot, "TRAINING REWARD 稽古の成果");
			} else {
				this.renderLootUI([], "LOST FOCUS 灰"); // The Ash Card!
			}
			this.practiceEarnedLoot = null; // Clear it so it only fires once
		}

		// 2. Check for Combat Match Loot
		if (this.pendingMatchLoot) {
			// A glorious title for winning an actual bout
			this.renderLootUI(this.pendingMatchLoot, "MATCH REWARD 勝利の恵み");
			this.pendingMatchLoot = null; // Clear it so it only fires once
		}
		
		if (this.music) {
            this.music.stopMatchDrums();
            this.music.startAmbient();
        }
    },

    renderCampaignMenu: function() {
        // [Your existing renderCampaignMenu code remains exactly as you wrote it]
        // 1. Render Status of Active Basho (if exists)
        const statusEl = document.getElementById('basho-status');
        const pipContainer = document.getElementById('hoshitori-hyo');
        
        if (this.career.activeBasho) {
            statusEl.classList.remove('hidden');
            const ab = this.career.activeBasho;
            document.getElementById('basho-div-name').innerText = this.DIVISIONS[ab.div].name.toUpperCase();
            document.getElementById('basho-record').innerText = `${ab.wins} - ${ab.losses}`;
            
            const totalMatches = this.DIVISIONS[ab.div].maxMatches;
            
            // Render Pips (15 Slots)
            pipContainer.innerHTML = '';
            for(let i=0; i< totalMatches; i++) {
                const p = document.createElement('div');
                p.className = 'hoshitori-pip';
                if (i < ab.history.length) {
                    p.classList.add(ab.history[i] === 'W' ? 'win' : 'loss');
                }
                pipContainer.appendChild(p);
            }
        } else {
            statusEl.classList.add('hidden');
        }

       // 2. Render Division Buttons
        for(let i=0; i<6; i++) {
            const btn = document.getElementById(`div-${i}`);
            const statusTxt = btn.querySelector('.rank-status');
            
            // Reset state (Added 'division-cleared' to the cleanup)
            btn.classList.remove('locked', 'active-basho', 'division-cleared');
            
            if (i > this.career.unlockedDiv) {
                // Locked (Above Current Rank)
                btn.classList.add('locked');
                statusTxt.innerText = "LOCKED";
            } else if (i < this.career.unlockedDiv) {
                // Cleared (Below Current Rank)
                btn.classList.add('division-cleared'); 
                
                // --- NEW: Check if they are a Champion of this division ---
                if (this.career.highestPerfectDiv !== undefined && i <= this.career.highestPerfectDiv) {
                    statusTxt.innerText = "CHAMPION";
                    statusTxt.style.color = "#d93a3a"; // Highlight in Red!
                    statusTxt.style.fontWeight = "bold";
                } else {
                    statusTxt.innerText = "CLEARED";
                    statusTxt.style.color = "#b8860b"; // Failsafe reset
                    statusTxt.style.fontWeight = ""; // Failsafe reset
                }
            } else {
                // Current Division (The only one they can play)
                statusTxt.innerText = "OPEN";
                statusTxt.style.color = ""; // Failsafe reset
                statusTxt.style.fontWeight = ""; // Failsafe reset
                // Highlight Active
                if (this.career.activeBasho && this.career.activeBasho.div === i) {
                    btn.classList.add('active-basho');
                    statusTxt.innerText = "IN PROGRESS";
                }
            }
        }
    },
	
	startBasho: function(divIndex) {
        if (divIndex !== this.career.unlockedDiv) return;

        if (!this.career.activeBasho || this.career.activeBasho.div !== divIndex) {
            this.career.activeBasho = {
                div: divIndex,
                wins: 0, losses: 0, history: []
            };
            this.saveCareer();
        }

        const divData = this.DIVISIONS[divIndex];
        let opponentName = "";
        let isSanYaku = false;

        if (divIndex === 5) {
            // MAKUUCHI RANKING LOGIC (Preserved)
            const roll = Math.random();
            if (roll < 0.05) { opponentName = "Yokozuna"; isSanYaku = true; }
            else if (roll < 0.15) { opponentName = "Ozeki"; isSanYaku = true; }
            else if (roll < 0.25) { opponentName = "Sekiwake"; isSanYaku = true; }
            else if (roll < 0.40) { opponentName = "Komusubi"; isSanYaku = true; }
            else { 
                // Standard Maegashira rank
                const rankNum = Math.floor(Math.random() * 17) + 1;
                const side = Math.random() > 0.5 ? "East" : "West";
                opponentName = `Maegashira #${rankNum} ${side}`; 
            }
        } else {
            // LOWER DIVISION RANKING LOGIC
            // Generates something like "Jonidan #42 West"
            const rankNum = Math.floor(Math.random() * 50) + 1;
            const side = Math.random() > 0.5 ? "East" : "West";
            opponentName = `${divData.name} #${rankNum} ${side}`;
        }

        this.currentOpponentName = opponentName;
        this.currentOpponentRank = isSanYaku;
        
        this.startCPU(divIndex); 
    },
    
    startSubtitleCycle: function() {
        const el = document.getElementById('main-subtitle');
        if (!el) return;
        if (this.subtitleInterval) clearInterval(this.subtitleInterval);
        this.subtitleInterval = setInterval(() => {
            el.classList.add('fade-out');
            setTimeout(() => {
                this.subtitleIndex = (this.subtitleIndex + 1) % this.subtitles.length;
                const txt = this.subtitles[this.subtitleIndex];
                el.innerText = txt;
                const isJap = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(txt);
                el.style.fontFamily = isJap ? 'var(--font-jap)' : 'var(--font-ui)';
                el.style.letterSpacing = isJap ? '0.2em' : '4px';
                el.classList.remove('fade-out');
                el.classList.add('prep-in');
                void el.offsetWidth;
                el.classList.remove('prep-in');
            }, 1500); 
        }, 9000); 
    },
    
	startAtmosphereLoop: function() {
        if (!this.atm) this.atm = { currentWind: 0, targetWind: 0 };
        
        const loop = () => {
            // Smoothly approach the baseline wind
            this.atm.currentWind += (this.atm.targetWind - this.atm.currentWind) * 0.005;
            
            // Push to the VFX engine to handle ambient drift
            if (typeof vfx !== 'undefined') vfx.globalWind = this.atm.currentWind;

            requestAnimationFrame(loop);
        };
        loop();
    },

    updateWindBalance: function() {
        if (!this.atm || typeof this.p1.hp === 'undefined' || typeof this.p2.hp === 'undefined') return;
        const diff = this.p1.hp - this.p2.hp;
        this.atm.targetWind = diff * 600; 
    },

	// --- NEW: Triggers a physical wave in the VFX engine ---
	triggerWindGust: function(winnerSide, damageDealt, travelTimeMs = 0) {
        if (typeof vfx === 'undefined') return;
        
        const dir = winnerSide === 1 ? 1 : -1;
        
        // Spawn slightly off-screen
        const startX = winnerSide === 1 ? -150 : vfx.canvas.width + 150;
        
        let waveSpeed = dir * 15; // Default fallback speed
        
        // --- THE ANTICIPATION MATH ---
        if (travelTimeMs > 0) {
            // Distance from start position to exact center of the screen
            const distanceToCenter = (vfx.canvas.width / 2) + 150; 
            
            // Convert the hit delay into 60fps frames
            const framesAvailable = (travelTimeMs / 1000) * 60;
            
            // Velocity = Distance / Time
            waveSpeed = dir * (distanceToCenter / Math.max(1, framesAvailable));
        }
        
        const pushStrength = dir * (2.5 + damageDealt * 0.75);
        
        // Send it to the engine! 
        vfx.spawnGust(startX, waveSpeed, pushStrength, 450); 
    },
	
	hexToRgb: function(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 1, g: 1, b: 1 };
    },
	
	createPetals: function(isGame) {
        const isMobile = window.innerWidth < 768;
        let count = isGame ? 300 : 300; 
        if (isMobile && isGame) count = 50;
        
        const cWidth = vfx.canvas.width;
        const cHeight = vfx.canvas.height;
        
        const particleType = this.getCurrentParticleType();
        
        for(let i = 0; i < count; i++) {
            const color = this.getWeightedPetalColor();
            
            // --- NEW: THE PARALLAX MATH ---
            // Generate a depth between 0.3 (deep background) and 1.0 (foreground)
            const zDepth = (Math.random() * 0.7) + 0.3; 
            
            let x = Math.random() * cWidth;
            let y = Math.random() * cHeight + 50;
            
            // Scale size by depth
            const baseSize = Math.random() * 15 + 10;
            const size = baseSize * zDepth; 
            
            // Scale falling speed by depth (further away = falls slower)
            const duration = (Math.random() * 12 + 18);
            const baseVy = cHeight / (duration * 60); 
            const vy = baseVy * zDepth; 
            
            // Scale rotation by depth
            const tumbleDuration = (Math.random() * 5 + 10);
            let angularVelocity = ((Math.PI * 2) / (tumbleDuration * 60)) * zDepth;
            if (Math.random() > 0.5) angularVelocity *= -1; 
            
            const startAngle = Math.random() * Math.PI * 2;
            
            // Atmospheric Perspective: Fade particles further in the background
            const alpha = 0.35 + (0.63 * zDepth); 
            
            vfx.emit(x, y, 0, vy, size, color.r, color.g, color.b, alpha, -1, startAngle, angularVelocity, particleType, zDepth);
        }
    },
	
	getCurrentParticleType: function() {
        // If not in single player campaign, default to Sakura (0.0)
        if (this.mode !== 'cpu' || !this.career) return 0.0; 
        
        const basho = this.career.bashoIndex || 0;
        if (basho === 0) return 2.0; // Hatsu (Jan) - Snow
        if (basho === 1) return 3.0; // Haru (Mar) - Blossoms
        if (basho === 2) return 0.0; // Natsu (May) - Sakura
        if (basho === 3) return 4.0; // Nagoya (Jul) - Grass
        if (basho === 4) return 5.0; // Aki (Sep) - Diamond
        if (basho === 5) return 6.0; // Kyushu (Nov) - Fall Leaf
		
        
        return 0.0;
    },
	
	getWeightedPetalColor: function() {
		// Current health ratios (0.0 to 1.0)
		const p1Ratio = this.p1.hp / this.p1.maxHp;
		const p2Ratio = this.p2.hp / this.p2.maxHp;
		
		// Squaring these makes the dominant player's color significantly more likely
		const wBlue = Math.pow(p1Ratio * 10, 2);
		const wPink = Math.pow(p2Ratio * 10, 2);
		const wWhite = (p1Ratio + p2Ratio) * 5; // Neutral white for balance
		
		const totalWeight = wBlue + wPink + wWhite;
		const r = Math.random() * totalWeight;
		
		let hex = '#ffffff';
		// FIXED LOGIC: Match the weight to the correct color
		if (r < wBlue) {
			hex = '#d6eaf8'; // P1 BLUE
		} else if (r < wBlue + wPink) {
			hex = '#f1a7b9'; // P2 PINK
		}
		
		return this.hexToRgb(hex);
	},
    
    resetStats: function() {
        this.p1 = { hp: 10, maxHp: 10, mom: 2, move: null, build: null, streak: 0, lastActionIndex: 0, lastActionIndex2: 0, lastActionIndex3: 0,
    totalAtks: 0, highUsed: 0, lowUsed: 0 };
        this.p2 = { hp: 10, maxHp: 10, mom: 2, move: null, build: null, streak: 0, lastActionIndex: 0, lastActionIndex2: 0, lastActionIndex3: 0,
    totalAtks: 0, highUsed: 0, lowUsed: 0 };
    },

	applyBuild: function(playerObj, buildKey) {
        const buildStr = String(buildKey);
        
        // Determine the tier level STRICTLY from the string. No local save overrides!
        let tier = 0; // 0 = 12 Will, 1 = 16 Will, 2 = 20 Will
        
        if (buildStr.includes('++')) {
            tier = 2;
        } else if (buildStr.includes('+')) {
            tier = 1;
        }

        // Clean the '+' symbols out of the string so we can parse the momentum number
        const mom = parseInt(buildStr.replace(/\+/g, ''));
        
        let baseWill = 12;
        if (tier === 1) baseWill = 16;
        if (tier === 2) baseWill = 20;

        const hp = baseWill - (mom * 2); 

        playerObj.hp = hp;
        playerObj.maxHp = hp;
        playerObj.mom = mom;
        playerObj.build = buildStr; 
        playerObj.move = null;
        playerObj.streak = 0;
        
        console.log("🛠️ BUILD APPLIED | Player:", playerObj === this.p1 ? "P1" : "P2", "| Momentum:", mom, "| Will (HP):", hp);
    },

    updateHUD: function() {
        const p1Bar = document.getElementById('p1-hp-bar');
        const p2Bar = document.getElementById('p2-hp-bar');

        //document.getElementById('p1-hp-txt').innerText = this.p1.hp;
        document.getElementById('p1-hp-bar').style.width = (this.p1.hp/this.p1.maxHp*100)+'%';
        this.renderPips('p1-mom-track', this.p1.mom, 'p1');
        document.getElementById('p1-stat').classList.toggle('inactive', this.turnPhase !== 1 && this.mode === 'local');

        //document.getElementById('p2-hp-txt').innerText = this.p2.hp;
        document.getElementById('p2-hp-bar').style.width = (this.p2.hp/this.p2.maxHp*100)+'%';
        this.renderPips('p2-mom-track', this.p2.mom, 'p2');
        document.getElementById('p2-stat').classList.toggle('inactive', this.turnPhase !== 2 && this.mode === 'local');
        
        // 2. CHECK FOR SHATTER (P1)
        if (this.p1.hp <= 0) {
            p1Bar.classList.add('shattered');
        } else {
            p1Bar.classList.remove('shattered');
        }

        // 3. CHECK FOR SHATTER (P2)
        if (this.p2.hp <= 0) {
            p2Bar.classList.add('shattered');
        } else {
            p2Bar.classList.remove('shattered');
        }

        // --- NEW: DYNAMIC IRON WALL x2 VISUALS (ANTI-STACKING FIX) ---
        const p1Iron = document.getElementById('p1-iron');
        const p2Iron = document.getElementById('p2-iron');
        
        const stickyHtml = '<span style="display: flex; align-items: center; justify-content: center; white-space: nowrap;">🛡️<span style="font-size:0.8rem; color:var(--gold); margin-left:2px; font-weight:900; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">x2</span></span>';

        if (p1Iron) {
            p1Iron.classList.toggle('visible', this.p1.streak >= 1);
            if (this.p1.streak >= 1) {
                p1Iron.innerHTML = this.p1.ironWallGrace > 0 ? stickyHtml : '🛡️';
            }
        }
        if (p2Iron) {
            p2Iron.classList.toggle('visible', this.p2.streak >= 1);
            if (this.p2.streak >= 1) {
                p2Iron.innerHTML = this.p2.ironWallGrace > 0 ? stickyHtml : '🛡️';
            }
        }
        // ----------------------------------------

        this.updateAtmosphere();
        
        // Update Breathing Animations based on exhaustion
        this.updateExhaustion('p1', this.p1);
        this.updateExhaustion('p2', this.p2);
        
        let tension = (this.p1.maxHp - this.p1.hp) / this.p1.maxHp;
    },
    
	updateAtmosphere: function() {
        const p1Val = (this.p1.hp / this.p1.maxHp) * 10;
        const p2Val = (this.p2.hp / this.p2.maxHp) * 10;
        const p1Sq = p1Val * p1Val;
        const p2Sq = p2Val * p2Val;

        const diff = p1Sq - p2Sq; 
        this.atm.targetWind = diff * 25; 
    },

    renderPips: function(id, count, playerClass) {
        const el = document.getElementById(id);
        el.innerHTML = '';
        for(let i=0; i<MAX_MOM; i++) {
            let pip = document.createElement('div');
            pip.className = `mom-pip ${i<count ? 'filled '+playerClass : ''}`;
            el.appendChild(pip);
        }
    },

    /* --- GAME FLOW --- */
	startLocal: function() {
        this.resetStats(); 
        this.mode = 'local';
        this.isTutorial = false;
        this.history = [];
        this.pendingBuild = null;
        this.hideOverlays();
        
        // 1. Reset Stats UI
        this.currentBuildMom = this.playerBuildMom !== undefined ? this.playerBuildMom : 1;
        this.updateBuildUI(); // <-- This was missing!
        
        // 2. Render the Tech Grid
        this.renderTechGrid();
        
        // 3. Reveal the screen
        document.getElementById('build-screen').classList.remove('hidden');
        document.getElementById('build-msg').innerText = "PLAYER 1: SELECT STYLE";
    },
    

    startCPU: function(diff) {
        this.resetStats();
        this.mode = 'cpu';
        this.cpuDiff = diff;
        this.isTutorial = (diff === 'tutorial');
        this.history = [];
        this.pendingBuild = null;
        this.hideOverlays();
		this.loadAI(diff);
		
		// --- NEW: DYNAMIC TEMPERATURE MAPPING ---
        // Lower temp = Predictable/Exploitable. Higher temp = Unpredictable Mixups.
        const tempMap = {
			'tutorial': 0.01,
			0: 0.05, // Jonokuchi
			1: 0.12, // Jonidan
			2: 0.18, // Sandanme
			3: 0.25, // Makushita
			4: 0.30, // Juryo
			5: 0.35  // Makuuchi
		};
    
    this.currentAITemp = tempMap[diff] || 0.10;

        // Sync the Debug UI slider if it's currently open on screen
        const tempSlider = document.getElementById('temp-slider');
        const tempDisplay = document.getElementById('temp-display');
        if (tempSlider && tempDisplay) {
            tempSlider.value = this.currentAITemp;
            tempDisplay.innerText = this.currentAITemp.toFixed(2);
        }

        // --- NEW: Generate CPU Loadout ---
        if (this.isTutorial) {
            this.cpuLoadout = ['strike', 'sweep', 'thrust', 'throw']; // Fixed for tutorial
        } else {
            this.cpuLoadout = this.generateCPULoadout(diff);
            // Optional: Log it for debugging
            console.log("CPU Loadout:", this.cpuLoadout); 
        }
        // ---------------------------------

        if (this.isTutorial) {
            this.selectBuild('yotsu'); 
        } else {
			// 1. Reset Stats UI for the human player
            this.currentBuildMom = this.playerBuildMom !== undefined ? this.playerBuildMom : 1;
            this.updateBuildUI();
            
            // 2. Render the Tech Grid
            this.renderTechGrid();

            // 3. Reveal the screen
            document.getElementById('build-screen').classList.remove('hidden');
            document.getElementById('build-msg').innerText = "SELECT YOUR STYLE";
        }
    },

	startOnline: function() {
        this.resetStats(); 
        this.mode = 'online';
        this.isTutorial = false;
        this.history = [];
        this.pendingBuild = null;
        
        this.hideOverlays(); 
        
        // 1. Reset the UI slider to default before showing it
        this.currentBuildMom = this.playerBuildMom !== undefined ? this.playerBuildMom : 1;
        this.updateBuildUI();
		this.renderTechGrid();
        
        // 2. Reveal the Build Screen
        document.getElementById('build-screen').classList.remove('hidden');
        
        // 3. THE POLISH: Hype up the match by showing who they are fighting
        const oppName = net.opponentName ? net.opponentName.toUpperCase() : "CHALLENGER";
        
        // Unhide the VS wrapper and inject the name
        document.getElementById('build-vs-text').classList.remove('hidden');
        document.getElementById('build-opp-name').innerText = oppName;
        document.getElementById('build-msg').innerText = "ALLOCATE STARTING STATS";
    },

	selectBuild: function(buildKey) {
        if (typeof sound !== 'undefined') sound.play('click');
        let buildVal = buildKey.toString(); 

        if (this.isTutorial) {
            this.applyBuild(this.p1, '2'); 
            this.applyBuild(this.p2, '2');
            this.initMatch("TUTORIAL");
            return;
        }
        
        // Append + or ++ based on the player's stage for accurate network syncing
        const { stage } = this.getExpAndHair();
        if (stage === 3) buildVal += '++';
        else if (stage === 2) buildVal += '+';
		
		// --- NEW: BASHO CPU INTERCEPTOR ---
        if (typeof net !== 'undefined' && net.isBashoCPUMatch) {
            this.mode = 'cpu'; // Switch engine to offline mode
            this.applyBuild(this.p1, buildVal); // Lock in human's choice
            
            // Feed the generated Firebase data into the local CPU slot (FIXED VARIABLE NAME)
            this.cpuLoadout = net.bashoCPUData.loadout; 
            
            this.currentOpponentCosmetics = net.bashoCPUData.cosmetics;
            this.currentOpponentName = net.bashoCPUData.name;
            this.p2.hasStickyWall = net.bashoCPUData.hasStickyWall;
            this.cpuDiff = net.bashoData.rules.cpuDiff || 1; // Tells AI how smart to play
            
            // Generate CPU Momentum based on difficulty
            let maxMom = 2;
            let cpuFlag = '';
            if (this.cpuDiff >= 2 && this.cpuDiff <= 3) { maxMom = 4; cpuFlag = '+'; }
            if (this.cpuDiff >= 4) { maxMom = 6; cpuFlag = '++'; }
            const cpuMomRaw = Math.floor(Math.random() * (maxMom + 1)).toString();
            
            this.applyBuild(this.p2, cpuMomRaw + cpuFlag);
            
            document.getElementById('build-screen').classList.add('hidden');
            this.initMatch(this.currentOpponentName);
            return;
        }
        
        if (this.mode === 'local') {
            if (!this.pendingBuild) {
                this.pendingBuild = buildVal;
                document.getElementById('build-msg').innerText = "PLAYER 2: ALLOCATE STATS";
                this.currentBuildMom = 1;
                this.updateBuildUI();
                this.p2Loadout = ['strike', 'sweep', 'thrust', 'throw'];
                this.renderTechGrid(); 
            } else {
                this.applyBuild(this.p1, this.pendingBuild);
                this.applyBuild(this.p2, buildVal);
                this.initMatch("PLAYER 2");
            }
        }
        else if (this.mode === 'cpu') {
            this.applyBuild(this.p1, buildVal);
            
            let cpuTier = 0; // 0 = 12 Will, 1 = 16 Will, 2 = 20 Will
            
            // Division 0 (Jonokuchi) & Division 1 (Jonidan)
            if (this.cpuDiff === 'tutorial' || this.cpuDiff < 2) {
                cpuTier = 0; // 100% Base (3 styles)
            } 
            // Division 2 (Sandanme)
            else if (this.cpuDiff === 2) {
                cpuTier = Math.random() < 0.60 ? 1 : 0; // 60% Chonmage, 40% Base
            } 
            // Division 3 (Makushita)
            else if (this.cpuDiff === 3) {
                cpuTier = 1; // 100% Chonmage (5 styles)
            } 
            // Division 4 (Juryo)
            else if (this.cpuDiff === 4) {
                cpuTier = Math.random() < 0.40 ? 2 : 1; // 40% Ōichōmage, 60% Chonmage
            } 
            // Division 5 (Makuuchi)
            else {
                cpuTier = 2; // 100% Ōichōmage (7 styles)
            }
            
            let maxMom = 2;
            let cpuFlag = '';
            
            if (cpuTier === 1) { maxMom = 4; cpuFlag = '+'; }
            if (cpuTier === 2) { maxMom = 6; cpuFlag = '++'; }
            
            const cpuMomRaw = Math.floor(Math.random() * (maxMom + 1)).toString();
            const cpuMom = cpuMomRaw + cpuFlag;

            this.applyBuild(this.p2, cpuMom);
            
            const diffName = this.DIVISIONS[this.cpuDiff].name;
            this.initMatch(diffName.toUpperCase());
        }
        else if (this.mode === 'online') {
            const myPlayer = net.side === 'host' ? this.p1 : this.p2;
            this.applyBuild(myPlayer, buildVal);
            net.sendBuild(buildVal); 
            
            document.getElementById('build-screen').classList.add('hidden');
            //document.getElementById('log-area').innerHTML = '<div style="text-align:center;color:#999;margin-top:10px;">Waiting for opponent to finalize loadout...</div>'; Deprecated, replaced with overlay.
            net.checkBuildReady();
        }
		// --- NEW: WAITING SCREEN LOGIC ---
        if (this.mode === 'online') {
            const opponent = net.side === 'host' ? this.p2 : this.p1;
            
            // If the opponent hasn't locked in yet, show the waiting screen!
            if (!opponent.build) {
                document.getElementById('online-waiting-loadout').classList.remove('hidden');
            }
        }
    },
	
	getActiveBuildPlayer: function() {
        if (this.mode === 'online') {
            // In online, the host is always P1 (Blue), joiner is P2 (Red)
            return net.side === 'host' ? 1 : 2;
        }
        if (this.mode === 'local') {
            // If pendingBuild exists, P1 has already chosen. It is now P2's turn!
            return this.pendingBuild ? 2 : 1;
        }
        // For CPU and Tutorial modes, the human is always Player 1
        return 1; 
    },

	adjustBuildMom: function(amount, context = 'build') {
        let currentMom = context === 'stable' ? 
            (this.playerBuildMom !== undefined ? this.playerBuildMom : 1) : 
            this.currentBuildMom;
        
        const oldMom = currentMom;
        currentMom += amount;
        
        // Clamp dynamically based on Hair Stage
        const { stage } = this.getExpAndHair();
        let maxMom = 2;
        if (stage === 4) maxMom = 6;      // Ōichōmage
        else if (stage === 3) maxMom = 5; // Tsuyamage (NEW)
        else if (stage === 2) maxMom = 4; // Chonmage
        else if (stage === 1) maxMom = 3; // Mage

        if (currentMom < 0) currentMom = 0;
        if (currentMom > maxMom) currentMom = maxMom;
        
        if (context === 'stable') {
            this.playerBuildMom = currentMom;
            this.saveLoadout(); 
        } else {
            this.currentBuildMom = currentMom;
        }
        
        if (currentMom > oldMom) {
            if (typeof sound !== 'undefined') sound.play('powerup');
            for (let i = oldMom + 1; i <= currentMom; i++) this.playPipAnimation(i, 'gain', context);
        } else if (currentMom < oldMom) {
            if (typeof sound !== 'undefined') sound.play('powerdown');
            for (let i = oldMom; i > currentMom; i--) this.playPipAnimation(i, 'lose', context);
        }
        
        this.updateBuildUI(context);
        if (context === 'build' && this.renderTechGrid) this.renderTechGrid(); 
    },

    playPipAnimation: function(pipIndex, type, context = 'build') {
        // Direct the FX to the correct DOM element based on context
        const prefix = context === 'stable' ? 'stable-b-pip-' : 'b-pip-';
        const pip = document.getElementById(`${prefix}${pipIndex}`);
        if (!pip) return;
        
        const playerNum = context === 'stable' ? 1 : (this.getActiveBuildPlayer ? this.getActiveBuildPlayer() : 1);
        const playerClass = playerNum === 1 ? 'p1' : 'p2';

        const fx = document.createElement('div');
        if (type === 'gain') {
            fx.className = `pip-gain-fx ${playerClass}`; 
        } else if (type === 'lose') {
            fx.className = 'pip-shatter-fx'; 
        }

        pip.appendChild(fx);
        setTimeout(() => { if (fx.parentNode) fx.remove(); }, 600); 
    },
			
	getMaxAllowedBuildStage: function() {
        // 1. Get their standard single-player unlocks
        // Pass 'true' to safely bypass the network rules and prevent an infinite loop!
        const localMax = this.getExpAndHair(true).stage; 

        // 2. If we are online, check the lobby rules
        if (this.mode === 'online' && typeof net !== 'undefined' && net.matchRules && net.matchRules.maxBuild !== undefined) {
            
            // If it's a private invite, the host's rules override the guest's local unlocks!
            // (If host set 4, guest gets 4. If host set 2, guest is capped at 2).
            return net.matchRules.maxBuild; 
        }

        // 3. Offline or no rules found, default to their normal career unlocks
        return localMax;
    },
	
	sanitizeBuild: function() {
		// 1. Get the current legal stage based on current EXP
		const { stage } = this.getExpAndHair(true); // ignoreRules=true to get true career stage
		
		// 2. Define the legal max for this stage
		let maxAllowedMom = 2; // Zambara (Stage 0)
		if (stage >= 4) maxAllowedMom = 6;
		else if (stage === 3) maxAllowedMom = 5;
		else if (stage === 2) maxAllowedMom = 4;
		else if (stage === 1) maxAllowedMom = 3;

		// 3. Force the current selection into legal bounds
		// We check both the active menu selection and the stored career value
		if (this.currentBuildMom > maxAllowedMom) {
			this.currentBuildMom = Math.min(2, maxAllowedMom); // Reset to a safe default
		}
		
		if (this.playerBuildMom > maxAllowedMom) {
			this.playerBuildMom = Math.min(2, maxAllowedMom);
		}

		// Update the career object directly to ensure the next save is clean
		if (this.career) {
			this.career.lastBuildMom = this.playerBuildMom;
		}
	},

	updateBuildUI: function(context = 'build') {
		// --- THE FIX: SELF-HEAL ON RENDER ---
		this.sanitizeBuild();
        // 1. Get their standard single-player unlock stage
        let { stage } = this.getExpAndHair();
        
        // 2. Check if they are actively cycling through builds in the menu
        if (context === 'build' && this.currentBuildStage !== undefined) {
            stage = this.currentBuildStage;
        }

        // 3. NEW: Equalizer & Bouncer logic combined!
        if (this.getMaxAllowedBuildStage) {
            const maxAllowed = this.getMaxAllowedBuildStage();
            const equalize = typeof net !== 'undefined' && net.matchRules && net.matchRules.equalizeBuilds;

            if (equalize) {
                stage = maxAllowed; // Boost or cap, everyone is equalized!
            } else if (stage > maxAllowed) {
                stage = maxAllowed; // Standard bouncer: only cap high-levels
            }
        }
        
        let maxMom = 2;
        let baseWill = 12;
        if (stage >= 4) { maxMom = 6; baseWill = 20; }      // Ōichōmage
        else if (stage === 3) { maxMom = 5; baseWill = 16; } // Tsuyamage (NEW)
        else if (stage === 2) { maxMom = 4; baseWill = 16; } // Chonmage
        else if (stage === 1) { maxMom = 3; baseWill = 12; } // Mage

        const mom = context === 'stable' ? 
            (this.playerBuildMom !== undefined ? this.playerBuildMom : 1) : 
            this.currentBuildMom;
            
        const hp = baseWill - (mom * 2); 

        const playerNum = context === 'stable' ? 1 : (this.getActiveBuildPlayer ? this.getActiveBuildPlayer() : 1);
        const playerClass = playerNum === 1 ? 'p1' : 'p2';

        const pipPrefix = context === 'stable' ? 'stable-b-pip-' : 'b-pip-';
        const modId = context === 'stable' ? 'stable-will-modifier' : 'will-modifier-container';
        const momDescId = context === 'stable' ? 'stable-mom-desc' : 'mom-desc';
        const willDescId = context === 'stable' ? 'stable-will-desc' : 'will-desc';

        // 1. Update up to 6 Pips
        for (let i = 1; i <= 6; i++) {
            const pip = document.getElementById(`${pipPrefix}${i}`);
            if (pip) {
                if (i <= maxMom) {
                    pip.classList.remove('locked', 'p1', 'p2');
                    pip.classList.add(playerClass);
                    if (i <= mom) pip.classList.add('filled');
                    else pip.classList.remove('filled');
                } else {
                    pip.classList.add('locked');
                    pip.classList.remove('filled', 'p1', 'p2');
                }
            }
        }
        
        // Use Math.ceil so odd numbers (3, 5) perfectly center on their middle peg!
        const centerMom = Math.floor(maxMom / 2);
        const baseWillNormal = baseWill - (centerMom * 2);
        
        // 2. Build Modifier Stack (Dynamic Center)
        const modifierContainer = document.getElementById(modId);
        if (modifierContainer) {
            modifierContainer.innerHTML = ''; 
            
            if (hp === baseWillNormal) {
                modifierContainer.innerHTML = '<span class="will-symbol will-base">N/A</span>';
            } else if (hp > baseWillNormal) {
                for (let i = 0; i < (hp - baseWillNormal) / 2; i++) {
                    modifierContainer.innerHTML += '<span class="will-symbol will-plus">+</span>';
                }
            } else if (hp < baseWillNormal) {
                for (let i = 0; i < (baseWillNormal - hp) / 2; i++) {
                    modifierContainer.innerHTML += '<span class="will-symbol will-minus">-</span>';
                }
            }
        }
        
        // 3. Update Descriptions dynamically (Relative to Center)
        const momDesc = document.getElementById(momDescId);
        const willDesc = document.getElementById(willDescId);
        
        if (momDesc && willDesc) {
            const offset = mom - centerMom;
            
            if (offset === -3) {
                momDesc.innerHTML = `<span class="kanji-ghost">押し相撲++</span> <strong>Oshi-Zumo++:</strong> Legendary endurance.`;
                willDesc.innerText = "Immovable stance. Absorb endless blows to outlast in the dohyō.";
            } else if (offset === -2) {
                momDesc.innerHTML = `<span class="kanji-ghost">押し相撲+</span> <strong>Oshi-Zumo+:</strong> Relentless driving power.`;
                willDesc.innerText = "Granite footing. Extreme focus on stamina and absorption.";
            } else if (offset === -1) {
                momDesc.innerHTML = `<span class="kanji-ghost">押し相撲</span> <strong>Oshi-Zumo:</strong> Focus on rapid, driving strikes.`;
                willDesc.innerText = "Heavy footing. Excellent defensive foundation.";
            } else if (offset === 0) {
                momDesc.innerHTML = `<span class="kanji-ghost">均衡</span> <strong>Balanced:</strong> Adaptable pacing for a reactive strategy.`;
                willDesc.innerText = "Solid posture. A versatile foundation for any technique.";
            } else if (offset === 1) {
                momDesc.innerHTML = `<span class="kanji-ghost">四つ相撲</span> <strong>Yotsu-Zumo:</strong> Secure a deep grip for powerful throws.`;
                willDesc.innerText = "Aggressive stance. Sacrifice defense for early control.";
            } else if (offset === 2) {
                momDesc.innerHTML = `<span class="kanji-ghost">四つ相撲+</span> <strong>Yotsu-Zumo+:</strong> Overwhelming opening blitz.`;
                willDesc.innerText = "Glass cannon. Devastating momentum advantage, but highly vulnerable.";
            } else if (offset === 3) {
                momDesc.innerHTML = `<span class="kanji-ghost">四つ相撲++</span> <strong>Yotsu-Zumo++:</strong> Do or die. Pure offensive spirit.`;
                willDesc.innerText = "Paper stance. One misstep means total defeat.";
            }
        }
    },

    // This is fired by the "CONFIRM LOADOUT" button in the HTML
    confirmBuild: function() {
        let { stage } = this.getExpAndHair();
        
        // --- NEW: Equalizer & Bouncer logic combined! ---
        if (this.getMaxAllowedBuildStage) {
            const maxAllowed = this.getMaxAllowedBuildStage();
            const equalize = typeof net !== 'undefined' && net.matchRules && net.matchRules.equalizeBuilds;

            if (equalize) {
                stage = maxAllowed;
            } else if (stage > maxAllowed) {
                stage = maxAllowed;
            }
        }

        // Generate the base momentum string
        let buildString = this.currentBuildMom.toString();

        // Append the correct modifiers based on the RESTRICTED/BOOSTED stage
        if (stage >= 4) {
            buildString += '++';
        } else if (stage >= 2) {
            buildString += '+';
        }

        // Send the fully baked, rule-abiding string (e.g. "2" or "4+") 
        this.selectBuild(buildString);
    },
	
	getLocalName: function() {
        // If they are signed in, grab the first name and capitalize it
        if (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.displayName) {
            return auth.currentUser.displayName.split(' ')[0].toUpperCase();
        }
        // Fallback if they are playing without a Google account
        return "RIKISHI"; 
    },
	
	updateAvatarHair: function() {
        const p1Element = document.getElementById('p1-rikishi'); 
        const p2Element = document.getElementById('p2-rikishi'); 
        const previewElement = document.getElementById('preview-rikishi'); 
        
        if (!p1Element || !p2Element) return; 

        // --- THE DETECTIVE WORK ---
        const hairData = this.getExpAndHair();
        
        // Failsafe in case hairData is undefined
        const p1Stage = hairData ? hairData.stage : 0;

		let p2Stage = 0;
		
		if (this.mode === 'local') {
			p2Stage = p1Stage;
		} else {
			const p2Build = String(this.p2?.build || '');
			if (p2Build.includes('++')) {
				p2Stage = 4; // 👇 BUMPED to 4 (Ōichōmage)
			} else if (p2Build.includes('+')) {
				p2Stage = 2; // 👇 (Chonmage)
			}
		}

        const applyHair = (element, stage) => {
            if (!element) return; 
            element.classList.remove('hair-chonmage', 'hair-oichomage');
            
            // 👇 UPDATED: Check for the new stage numbers
            if (stage == 4) {
                element.classList.add('hair-oichomage');
            } else if (stage == 2 || stage == 3) {
                // Stages 2 (Chonmage) and 3 (Tsuyamage) share the same arena visual
                element.classList.add('hair-chonmage');
            }
        };

        applyHair(p1Element, p1Stage);
        applyHair(p2Element, p2Stage);
        if (previewElement) applyHair(previewElement, p1Stage);
    },

	initMatch: function(p2Label) {
        this.hideOverlays();
		this.updateWindBalance();
		this.sessionStats = { s_b: 0, s_a: 0, s_d: 0, t_b: 0, t_a: 0, t_d: 0 };
		this.matchStats = { iron_walls: 0, used_high: false, used_low: false, rounds: 0, lastMove: null, moveStreak: 0, uniqueHits: [], p1BalanceChecksSurvived: 0, p2BalanceChecksSurvived: 0,  };
		this.playerHasCycledThisMatch = false;
		this.lastDamageSource = 'normal';
		
		this.initDeckState(1);
		
		// --- INITIALIZE STICKY WALL BUFFS ---
		// We ONLY track the active turn counters now. The passive 'hasStickyWall' 
		// boolean is completely gone, replaced by the Kimedashi card!
		this.p1.ironWallGrace = 0;
		this.p2.ironWallGrace = 0;

		// --- NEW: DOHYO THEME INITIALIZATION ---
		let matchDohyo = 'dohyo_default';

        if (this.mode === 'online') {
            if (net.activeBashoId && net.bashoData) {
                // 1. ONLINE BASHO: The Tournament Host dictates the ring
                const bashoHost = net.bashoData.players[net.bashoData.hostUID];
                if (bashoHost && bashoHost.cosmetics && bashoHost.cosmetics.dohyo) {
                    matchDohyo = bashoHost.cosmetics.dohyo;
                }
            } else {
                // 2. ONLINE 1v1: The Lobby Host dictates the ring
                if (net.side === 'host') {
                    matchDohyo = this.playerCosmetics && this.playerCosmetics.dohyo ? this.playerCosmetics.dohyo : 'dohyo_default';
                } else {
                    matchDohyo = net.opponentCosmetics && net.opponentCosmetics.dohyo ? net.opponentCosmetics.dohyo : 'dohyo_default';
                }
            }
        } else {
            // 3. CPU / LOCAL: The Player dictates the ring
            matchDohyo = this.playerCosmetics && this.playerCosmetics.dohyo ? this.playerCosmetics.dohyo : 'dohyo_default';
        }

        // Apply the selected theme to the board!
        if (typeof this.applyDohyoTheme === 'function') {
            this.applyDohyoTheme(matchDohyo);
        }
        // ----------------------------------------

        const loadoutWaitScreen = document.getElementById('online-waiting-loadout');
        if (loadoutWaitScreen) loadoutWaitScreen.classList.add('hidden');
        
        document.body.classList.remove('hit-stop', 'game-over-active'); // Prevent Edge Case Visual Bug
        
        this.startCrowdLoop();
        
        if (this.mode === 'cpu') {
            this.generateCPUCosmetics();          
            if (this.career && this.career.bashoIndex !== undefined) {
                 BackgroundManager.setBashoScene(this.career.bashoIndex);
                 BackgroundManager.show();
            }
        } else {
            // Optional: If they are playing Local or Online, set a default background
            BackgroundManager.setCity('tokyo'); 
        }
        
        setTimeout(() => {
            const p1Rikishi = document.getElementById('p1-rikishi');
            const p2Rikishi = document.getElementById('p2-rikishi');
            
            // Helper to find which skin class the rikishi is currently wearing
            const getSkinClass = (el) => Array.from(el.classList).find(c => c.startsWith('skin-'));

            particleSystem.emit(getSkinClass(p1Rikishi), 'p1-rikishi');
            particleSystem.emit(getSkinClass(p2Rikishi), 'p2-rikishi');
        }, 400);
        
        const p1Name = document.querySelector('.p1-name');
        const p2Name = document.getElementById('p2-name-label');
        
        // --- CINEMATIC INTERCEPTION (CLEANED) ---
        if (this.isTutorial) {
            this.playCinematicIntro();
            return; 
        }
        
        if (this.mode === 'online') {
            localStorage.setItem('sumo_rage_quit_guard', net.opponentHosho || 0); // Plant Token to punish player if exiting match prematurely
            
            const myHosho = this.career.hosho_kin || 0;
            const opHosho = net.opponentHosho || 0;
            
            const p1Hosho = net.side === 'host' ? myHosho : opHosho;
            const p2Hosho = net.side === 'host' ? opHosho : myHosho;

            // Grab our local name, and the opponent's name from the network
            const myName = this.getLocalName();
            const opName = net.opponentName || (net.side === 'host' ? "GUEST" : "HOST");

            // Assign the correct name to the correct side of the screen
            const p1Label = net.side === 'host' ? myName : opName;
            const p2Label = net.side === 'host' ? opName : myName;

            p1Name.innerHTML = `${p1Label} <span id="p1-hosho-disp" style="color:var(--gold); font-size:0.8em; margin-left:5px;">[${p1Hosho}¥]</span>`;
            p2Name.innerHTML = `${p2Label} <span id="p2-hosho-disp" style="color:var(--gold); font-size:0.8em; margin-left:5px;">[${p2Hosho}¥]</span>`;
        } else if (this.mode === 'cpu' && this.currentOpponentName) {
            // CAREER MODE OVERRIDE
            p1Name.innerText = this.getLocalName(); 
            p2Name.innerText = this.currentOpponentName.toUpperCase();
            
            // If it's a San'yaku match, make text Gold
            if (this.currentOpponentRank) p2Name.style.color = "var(--gold)";
            else p2Name.style.color = "var(--p2-color)";
        } else {
            // LOCAL MULTIPLAYER OR DEFAULT
            p1Name.innerText = this.getLocalName();
            p2Name.innerText = p2Label;
        }
        
        document.getElementById('log-area').innerHTML = `
            <style>
                @keyframes elegantReveal {
                    0% { opacity: 0; transform: translateY(4px); } /* Reduced slide to prevent overflow */
                    100% { opacity: 1; transform: translateY(0); }
                }
                @keyframes gentleGlow {
                    0%, 100% { text-shadow: 0 0 4px rgba(0, 243, 255, 0.1); }
                    50% { text-shadow: 0 0 12px rgba(0, 243, 255, 0.5); }
                }
                .match-start-container {
                    text-align: center;
                    margin: 0; /* Zero outer margins */
                    padding: 8px 0; /* Tight, slim padding */
                    background: linear-gradient(90deg, transparent, rgba(15, 25, 40, 0.6), transparent);
                    border-top: 1px solid rgba(0, 243, 255, 0.2);
                    border-bottom: 1px solid rgba(0, 243, 255, 0.2);
                    animation: elegantReveal 1.2s ease-out forwards;
                    box-sizing: border-box; /* Forces padding inward */
                }
                .match-start-kanji {
                    color: #d4af37; 
                    font-size: 13px;
                    letter-spacing: 12px;
                    margin-right: -12px; 
                    font-weight: normal;
                    margin-bottom: 2px; /* Slimmer gap between Kanji and English */
                    opacity: 0.85;
                    line-height: 1; /* Eliminates invisible bottom spacing */
                }
                .match-start-english {
                    color: #f2e8e7; 
                    font-size: 18px;
                    font-weight: 300; 
                    letter-spacing: 4px;
                    text-transform: uppercase;
                    animation: gentleGlow 4s infinite ease-in-out;
                    line-height: 1.2; /* Tames the bottom boundary */
                }
            </style>
            <div class="match-start-container">
                <div class="match-start-kanji">はっけよい</div>
                <div class="match-start-english">Match Start</div>
            </div>
        `;
        
        // Reset Avatars first
        this.resetAvatars(true);
        document.getElementById('p1-rikishi').style.setProperty('--breathe-delay', '0s');
        document.getElementById('p2-rikishi').style.setProperty('--breathe-delay', '-1.5s');

        this.turnPhase = 1;
        
        // GYŌJI: Start of match shout
        setTimeout(() => {
            gyoji.shout("MATTA-NASHI!"); 
        }, 500); // Small delay so it happens as screen fades in

        // Normal start for non-tutorial modes
        document.getElementById('tutorial-overlay').classList.add('hidden');
        sound.play('match_start');
        
        this.startTurn(1);
        this.updateHUD();

        // --- NEW: Trigger Dynamic Music ---
        if (this.music) {
            this.music.startMatchDrums();
        }
    },
    
    updateTutorial: function() {
		const skipBtn = document.getElementById('skip-tutorial-btn');
		if (skipBtn) skipBtn.classList.remove('hidden'); 

		const overlay = document.getElementById('tutorial-overlay');
		const text = document.getElementById('tutorial-text');
		const arrow = document.getElementById('tutorial-arrow');
		const hpTrack = document.getElementById('p1-hp-bar').parentElement;
		const momTrack = document.getElementById('p1-mom-track');
		
		hpTrack.classList.remove('pulse-ui');
		momTrack.classList.remove('pulse-ui');
		overlay.classList.remove('hidden');
		
		switch(this.tutorialStep) {
			case 0:
				text.innerHTML = "押忍 <em>Osu!</em><br><br>Welcome to <strong>Sumo: Will & Momentum</strong> ❁<br>Clear your mind and we shall learn the ways of <em>Sumo</em> together.";
				arrow.style.display = 'block';
				break;
			case 1:
				text.innerHTML = "As a <em>Rikishi</em>, your abilities are bound by your <strong>Will</strong>, your <strong>Momentum</strong>, and the <strong>Activity Cards</strong> in your hand.";
				hpTrack.classList.add('pulse-ui');
				arrow.style.display = 'block';
				break;
			case 2:
				text.innerHTML = "Without <strong>Will</strong>, a Rikishi cannot endure in the ring.<br><br>Once a Rikishi's <em>Will</em> depletes, 負け越し <em>make-koshi</em> (it's over!)";
				hpTrack.classList.add('pulse-ui');
				arrow.style.display = 'block';
				break;
			case 3:
				text.innerHTML = "<strong>Momentum</strong> brings courage and ability.<br>The more you have, the more powerful cards you can play!";
				momTrack.classList.add('pulse-ui');
				arrow.style.display = 'block';
				break;
			case 4:
				text.innerHTML = "Notice your hand of cards. To perform any action, you must have the right <strong>Card</strong>.<br><br>Let's start by selecting your <strong>Build Momentum</strong> card!";
				arrow.style.display = 'none'; 
				break;
			case 5:
				text.innerHTML = "So we have begun!<br><br>You built Momentum, but your opponent played an <strong>Kimarite Card</strong> and struck you! You lost Will, but you are still in it! 残った <em>Nokotta!</em>";
				arrow.style.display = 'block';
				break;
			case 6:
				text.innerHTML = "Building Momentum gives you the power to use Kimarite Cards! Every kimarite has a Mom cost.<br><br>You have 1 Mom and an <strong>Oshidashi</strong> (High Kimarite) card. Play it now!";
				arrow.style.display = 'none';
				break;
			case 7:
				text.innerHTML = "よいしょ <em>Yoisho!</em><br>The move was Blocked.<br><br>Your Oshidashi is a <strong>High Kimarite</strong> and your opponent matched it with a <strong>High Block</strong> card.";
				arrow.style.display = 'block';
				break;
			case 8:
				// --- THE FIX: SPLIT TEXT PART 1 ---
				text.innerHTML = "A mismatched block results in a partial hit. Blocking costs no Momentum, but it does consume the card!";
				arrow.style.display = 'block';
				break;
			case 9:
				// --- THE FIX: SPLIT TEXT PART 2 ---
				text.innerHTML = "If you lack the cards you need, use the <strong>Discard</strong> button to cycle your hand.";
				arrow.style.display = 'block';
				break;
			case 10:
				text.innerHTML = "With Momentum depleted, let's defend. Perhaps your oppponent is winding up for a High Kimarite.<br><br>Play your <strong>High Block</strong> card!";
				arrow.style.display = 'none';
				break;
			case 11:
				text.innerHTML = "残った <em>Nokotta!</em><br>You blocked the kimarite perfectly!<br><br>The opponent is relentless and attacking again! Play another <strong>High Block</strong> to start a streak!";
				arrow.style.display = 'none';
				break;
			case 12:
				text.innerHTML = "Notice the Shield 🛡️?<br>A perfect block streak earns you an <strong>Iron Wall</strong> and grants free Momentum!<br><br>You are ready to strike back.";
				arrow.style.display = 'block';
				break;
			case 13:
				text.innerHTML = "You have an <strong>Uwatenage</strong> (High Kimarite) card, and 2 Momentum.<br><br>Finish them!";
				arrow.style.display = 'none';
				break;
			case 14:
				text.innerHTML = "<em>It Landed!</em> A spectacular hit.<br>More powerful Kimarite overcome weaker ones!<br><br>You are on your way to becoming a <strong>YOKOZUNA</strong>!";
				arrow.style.display = 'block';
				break;
			case 15:
				text.innerHTML = "Remember in Sumo and in Life:<br>礼に始まり、礼に終わる<br><em>It begins with courtesy and ends with courtesy.</em> ❁";
				arrow.style.display = 'block';
				break;
			default:
				overlay.classList.add('hidden');
				this.isTutorial = false; 
				this.renderControls(1);
				return;
		}
		
		this.renderControls(1);
	},
    
    nextTutorialStep: function() {
		if (!this.isTutorial) return;
		if ([4, 6, 10, 11, 13].includes(this.tutorialStep)) return; 
		this.tutorialStep++;
		this.updateTutorial();
	},

	hideOverlays: function() {
        // Hide all major full-screen menus and overlays
        document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));

        // --- NEW: Clean up move badges for the next turn/match ---
        document.querySelectorAll('.move-badge').forEach(badge => {
            badge.classList.remove('show', 'shattered'); 
            badge.innerHTML = ''; // Erase the shattered HTML halves
        });
		const heyaBtn = document.getElementById('global-heya-btn');
        if (heyaBtn) heyaBtn.classList.add('hidden');
    },
	
	updateExhaustion: function(pId, player) {
        const el = document.getElementById(`${pId}-rikishi`);
        if (!el) return;

        const healthPercent = player.hp / player.maxHp;
        
        // Calculate dynamic values
        // High HP: Fast/Subtle (3s) -> Low HP: Slow/Heavy (6s)
        const speed = 3 + (1 - healthPercent) * 3; 
        
        // High HP: Small bob (-4px) -> Low HP: Heavy bob (-10px)
        const bob = -4 - (1 - healthPercent) * 6;
        
        // High HP: Subtle scale (1.02) -> Low HP: Larger expansion (1.06)
        const scale = 1.02 + (1 - healthPercent) * 0.04;

        el.style.setProperty('--breathe-speed', `${speed}s`);
        el.style.setProperty('--breathe-bob', `${bob}px`);
        el.style.setProperty('--breathe-scale', scale);
    },
	
	/* --- IDLE ANIMATION SYSTEM --- */

	startIdleLoop: function() {
		// Clear any existing loop to prevent duplicates
		if (this.idleInterval) clearInterval(this.idleInterval);

		// Run check every 2 seconds, but only trigger based on random chance
		// This allows for variance (8-12 seconds average)
		this.idleInterval = setInterval(() => {
			// Only play idles during Selection Phase (1) or Post-Match (4)
			// Never interrupt Combat (3) or Tutorials
			if (this.turnPhase !== 1 && this.turnPhase !== 4) return;
			if (this.tutorialActive) return;

			// Try to trigger for P1
			if (Math.random() < 0.20) this.triggerIdle(this.p1, 'p1');
			
			// Try to trigger for P2 (Independent chance)
			if (Math.random() < 0.20) this.triggerIdle(this.p2, 'p2');

		}, 4000); // Checks every 2s, ~20% chance = happens roughly every 10s
	},

	triggerIdle: function(playerObj, playerClass) {
		const rikishi = document.querySelector(`.rikishi.${playerClass}`);
		if (!rikishi) return;

		// 1. IMPROVED BUSY CHECK
		// Check for ANY class that starts with "anim-" or "struck-"
		const isBusy = Array.from(rikishi.classList).some(c => 
			c.startsWith('anim-') || 
			c.startsWith('struck-') || 
			c === 'hit-anim' || 
			c === 'idle-override'
		);
		
		if (isBusy) return;

		// 2. Health-Based Pool Selection
		const hpPercent = playerObj.hp / playerObj.maxHp;
		let pool = [];

		if (hpPercent > 0.6) {
			pool = ['anim-shiko', 'anim-hop', 'anim-flare','anim-chest-bump','anim-brace','anim-neck-roll']; // Healthy/Spirit
		} else if (hpPercent > 0.2) {
			pool = ['anim-hop', 'anim-shiko', 'anim-flare', 'anim-chest-bump','anim-neck-roll','anim-shake-off','anim-stagger']; // Focused
		} else {
			pool = ['anim-stagger', 'anim-heavy-pant','anim-wince','anim-brace']; // Critical
		}

		const chosenAnim = pool[Math.floor(Math.random() * pool.length)];

		// 3. TRIGGER REFLOW (The "Force Restart" Trick)
		// This stops the 'breathe' animation and forces the browser to notice the new one
		rikishi.style.animation = 'none';
		rikishi.offsetHeight; // Trigger reflow
		rikishi.style.animation = '';

		// 4. Apply
		rikishi.classList.add('idle-override', chosenAnim);
		console.log(chosenAnim);

		// 5. Cleanup
		setTimeout(() => {
			rikishi.classList.remove('idle-override', chosenAnim);
		}, 1500);
	},

	startTurn: async function(playerNum) {
		this.turnCyclesCount = 0;
		this.turnDrawCount = 0
		const activePlayer = playerNum === 1 ? this.p1 : this.p2;

		// --- NEW: EXECUTE SHIKIRI-NAOSHI (THE DOOMSDAY TRIGGER) ---
		if (activePlayer.pendingShikiriPenalty > 0) {
			console.log(`[Shikiri-naoshi] Player ${playerNum}'s hand was blown away at the start of their turn!`);
			const handSize = activePlayer.hand ? activePlayer.hand.length : 0;
			
			if (handSize > 0) {
				// 1. Wipe the hand
				if (!activePlayer.discardPile) activePlayer.discardPile = [];
				activePlayer.discardPile.push(...activePlayer.hand);
				activePlayer.hand = [];
				
				// 2. Deal a fresh hand of the exact same size
				if (typeof this.drawCards === 'function') this.drawCards(playerNum, handSize);
				
				// 3. Play a dramatic sound effect
				if (typeof sound !== 'undefined') sound.play('card_flick', playerNum === 1 ? -0.5 : 0.5);
			}
			
			// Clear the penalty and vanish the debuff badge!
			activePlayer.pendingShikiriPenalty = 0;
			if (typeof this.renderDebuffs === 'function') this.renderDebuffs(playerNum);
			
			// Optional: Pause for 400ms so the user processes the tragedy before the UI unlocks
			await new Promise(resolve => setTimeout(resolve, 400));
		}

		// --- FIX: ONLINE OVERRIDE ---
		if (this.mode === 'online') {
			const mySide = (net.side === 'host') ? 1 : 2;
			this.turnPhase = mySide; 
			if (typeof gyoji !== 'undefined' && gyoji.startIdleTimer) gyoji.startIdleTimer();
			
			const myP = mySide === 1 ? this.p1 : this.p2;
			
			myP.bankedCycles = Math.max(1, myP.bankedCycles || 0);

			if (myP.cyclePenalty > 0) {
				this.freeCyclesRemaining = 0; 
				if (typeof this.renderDebuffs === 'function') this.renderDebuffs(mySide);
			} else {
				this.freeCyclesRemaining = myP.bankedCycles;
			}

			this.updateHUD();
			this.renderControls(mySide);

			if (net.queuedMove) {
				console.log("Animation finished! Applying queued opponent move.");
				const opp = net.side === 'host' ? this.p2 : this.p1;
				opp.networkHandTypes = net.queuedHandTypes;
				net.applyOpponentMove(net.queuedMove, net.queuedHandSize);
				
				net.queuedMove = null; 
				net.queuedHandSize = null; 
				net.queuedHandTypes = null; 
			}
			return;
		}
		// -----------------------------
		
		if (typeof gyoji !== 'undefined' && gyoji.startIdleTimer) gyoji.startIdleTimer();
		
		this.turnPhase = playerNum;
		this.updateHUD();

		// 1. CPU Mode Logic
		if (playerNum === 2 && this.mode === 'cpu') {
			
			// --- THE FIX: PERSISTENT BANK & NEKODAMASHI LOCK (CPU) ---
			this.p2.bankedCycles = Math.max(1, this.p2.bankedCycles || 0);
			let cpuCanDiscard = !(this.p2.cyclePenalty > 0);
			if (!cpuCanDiscard && typeof this.renderDebuffs === 'function') this.renderDebuffs(2);

			if (this.isTutorial) {
				if (this.tutorialStep === 4) this.p2.move = 'strike'; 
				else if (this.tutorialStep === 6) this.p2.move = 'h_block'; 
				else if (this.tutorialStep === 10 || this.tutorialStep === 11) this.p2.move = 'strike'; 
				else if (this.tutorialStep === 13) this.p2.move = 'l_block'; 
				else this.p2.move = 'build';
			} else {
				// --- CPU SOFT LOCK CHECK ---
				// Before the AI thinks, check if the CPU is physically capable of moving!
				let isStarved = false;
				if (!cpuCanDiscard || this.p2.bankedCycles <= 0) {
					// 1. Reconstruct the CPU's full potential move set
					let attackMoves = ['strike', 'sweep', 'thrust', 'throw']; 
					if (this.cpuLoadout && this.cpuLoadout.length >= 4) attackMoves = this.cpuLoadout;
					const fullDeck = ['build', ...attackMoves, 'h_block', 'l_block'];

					// 2. Check if ANY card in hand can power ANY move it can afford
					const isAnyMovePlayable = fullDeck.some(k => {
						const m = MOVES[k];
						if (!m || this.p2.mom < m.cost) return false;
						
						let req = '';
						if (m.type.includes('atk')) req = m.type.includes('high') ? 'h_attack' : 'l_attack';
						else if (m.type.includes('def')) req = m.type.includes('high') ? 'h_block' : 'l_block';
						else if (m.type.includes('util')) req = 'build';

						return this.p2.hand && this.p2.hand.some(card => card.type === req);
					});

					if (!isAnyMovePlayable) isStarved = true;
				}

				if (isStarved) {
					console.warn("[CPU Soft Lock] CPU has no playable cards and no discards! Forcing Stall.");
					this.p2.move = 'stall';
					// Add a dramatic pause for the UI
					await new Promise(resolve => setTimeout(resolve, 1800));
				} else {
					// If not starved, let the Grandmaster AI choose a move
					this.p2.move = await this.getCPUMove();
				}
			}
			
			// Only pay for the move if the CPU didn't stall!
			// THE FIX: Removed `cpuCanDiscard` and `bankedCycles > 0` constraints here. 
			// The CPU MUST physically animate playing a card to attack, even if Nekodamashi is active!
			if (this.p2.move !== 'stall' && this.p2.hand) {
				const moveObj = MOVES[this.p2.move];
				let reqCard = 'build';
				if (moveObj && moveObj.type.includes('atk')) reqCard = moveObj.type.includes('high') ? 'h_attack' : 'l_attack';
				else if (moveObj && moveObj.type.includes('def')) reqCard = moveObj.type.includes('high') ? 'h_block' : 'l_block';

				let cardIndex = this.p2.hand.findIndex(c => c.type === reqCard);

				if (cardIndex === -1) {
					const commons = ['build', 'h_attack', 'l_attack', 'h_block', 'l_block'];
					cardIndex = this.p2.hand.findIndex(c => commons.includes(c.type));
				}

				if (cardIndex !== -1) {
					const domCards = document.querySelectorAll('[id^="opp-card-"]');
					domCards.forEach(cardEl => {
						if (cardEl.classList.contains('opp-discard-shoot')) return; 
						
						const idx = parseInt(cardEl.id.split('-').pop());
						cardEl.classList.remove('slide-over-bounce', 'flip-reveal-half', 'flip-reveal-full', 'card-draw-single', 'card-enter-cascade');
						
						if (idx === cardIndex) {
							cardEl.style.animationDelay = '0s';
							cardEl.classList.add('card-play-out-fast');
							if (typeof sound !== 'undefined') sound.play('card_flick', 0.6);
						} else {
							cardEl.style.animationDelay = `${idx * 0.03}s`;
							cardEl.classList.add('card-swoop-out');
							if (typeof sound !== 'undefined') sound.play('card_flick', 0.6);
						}
					});

					await new Promise(resolve => setTimeout(resolve, 500)); 

					const spentCard = this.p2.hand.splice(cardIndex, 1)[0];
					if (!this.p2.discardPile) this.p2.discardPile = [];
					this.p2.discardPile.push(spentCard);
					
					// Only deduct a cycle if the CPU was actually allowed to use one
					if (cpuCanDiscard && this.p2.bankedCycles > 0) {
						this.p2.bankedCycles--;
					}
					
					if (typeof this.drawCards === 'function' && this.p2.hand.length < 5) {
						this.drawCards(2, 1);
					}
				}
			}
			this.resolveTurn();
			return;
		}

		// 2. Local PvP Logic
		if (playerNum === 2 && this.mode === 'local') {
			document.getElementById('turn-msg').innerText = "PLAYER 2 TURN";
			document.getElementById('turn-overlay').classList.remove('hidden');
			document.getElementById('controls').innerHTML = '';
			return; 
		}		
		
		if (playerNum === 1) {
			this.wakiBonusUsed = false;

			this.p1.bankedCycles = Math.max(1, this.p1.bankedCycles || 0);

			if (this.p1.cyclePenalty > 0) {
				this.freeCyclesRemaining = 0; 
				if (typeof this.renderDebuffs === 'function') this.renderDebuffs(1);
			} else {
				this.freeCyclesRemaining = this.p1.bankedCycles; 
			}
		}
		
		// --- RESILIENT SOFT SYNC ---
		if (this.music && this.music.isEnabled && this.music.isLooping) {
			const amb = this.music.stems.ambient_loop;
			const drm = this.music.stems.drums_loop;
			
			const ambPos = amb.seek();
			const drmPos = drm.seek();

			// Case A: Both are playing - ensure they are aligned
			if (amb.playing() && drm.playing()) {
				if (Math.abs(ambPos - drmPos) > 0.05) { // Only sync if drift is > 50ms
					drm.seek(ambPos);
				}
			} 
			// Case B: Ambient died (The Glitch you saw) - Restart it from the Drums' position!
			else if (!amb.playing() && drm.playing()) {
				console.warn("[Music] Ambient dropout detected. Performing Emergency Recovery...");
				amb.play();
				amb.seek(drmPos);
				amb.fade(0, this.music.volAmbient, 1000);
			}
		}

		// 3. Render Controls (This handles the Player's Soft Lock check internally!)
		this.renderControls(playerNum);
	},

    renderControls: function(pNum, animateMode = 'full') {
		// 1. Forceful Reset
		document.querySelectorAll('.card-sim-hover').forEach(el => el.classList.remove('card-sim-hover'));
		
		this.keyboardHoveredCardIndex = null; 
		const renderStartTime = Date.now();

		const p = pNum === 1 ? this.p1 : this.p2;
		
		// --- INITIALIZE DECK BEFORE UI EVALUATION ---
		if (!p.hand || p.hand.length === 0) {
			if (typeof this.initDeckState === 'function') this.initDeckState(pNum);
		}

		const c = document.getElementById('controls');
		
		// --- DETERMINE MOVE SET ---
		let attackMoves = ['strike', 'sweep', 'thrust', 'throw']; 
		if (this.isTutorial) {
			attackMoves = ['strike', 'sweep', 'thrust', 'throw'];
		} else if (this.mode === 'local' && pNum === 2) {
			if (this.p2Loadout && this.p2Loadout.length >= 4) attackMoves = this.p2Loadout;
		} else {
			if (this.playerLoadout && this.playerLoadout.length >= 4) attackMoves = this.playerLoadout;
		}

		// --- INJECT HTML FIRST ---
		const alignEdge = pNum === 1 ? 'flex-start' : 'flex-end';
		c.innerHTML = `
			<div style="display: flex; flex-direction: column; align-items: ${alignEdge}; width: 100%;">
				<div id="activity-card-container"></div>
				<div id="controls-layout">
					<div class="control-group group-util" id="cg-util"></div>
					<div class="control-group group-def" id="cg-def"></div>
					<div class="control-group group-atk ${attackMoves.length === 5 ? 'five-slots' : ''}" id="cg-atk"></div>
				</div>
			</div>
		`;

		const fullDeck = ['build', ...attackMoves, 'h_block', 'l_block'];

		fullDeck.forEach((k, i) => { 
			if (!MOVES[k]) return;
			const m = MOVES[k];
			const btn = document.createElement('button');
			
			if (k === 'build') btn.id = 'btn-build';
			else if (k === 'h_block') btn.id = 'btn-h_block';
			else if (k === 'l_block') btn.id = 'btn-l_block';
			else btn.id = `atk-${i-1}`; 

			btn.className = `card-btn ${m.type.split('_')[0]} ${m.type.includes('low') ? 'low-move' : ''}`;
			
			btn.innerHTML = `
				<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; pointer-events: none;">
					${MOVE_ICONS[k] ? `<div style="width: 28px; height: 28px;">${MOVE_ICONS[k]}</div>` : `<div style="font-size: 1.6rem; line-height: 1;">${m.icon || '?'}</div>`}
				</div>
				<div class="card-tooltip">
					<span class="card-name">${m.name}</span>
					<span class="card-cost">${m.cost > 0 ? m.cost + ' Mom' : 'Free'}</span>
					<span class="card-type">${m.type.replace('_',' ')}</span>
				</div>
			`;
			
			if (p.mom < m.cost) btn.disabled = true;

			// --- NEW: CHECK IF MOVE IS SEALED ---
			if (!p.disabledMoves) p.disabledMoves = [];
			const isSealed = p.disabledMoves.includes(k);
			
			if (isSealed) {
				btn.disabled = true;
				btn.classList.add('sealed-move');
				btn.innerHTML += `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:3rem; color:rgba(217, 58, 58, 0.8); text-shadow: 0 0 10px rgba(0,0,0,0.5); pointer-events:none; z-index: 5;">❌</div>`;
			}

			let requiredCard = '';
			let validCards = [];
			
			// --- THE PRIORITY ARRAYS ---
			// Index 0 is the common card. Index 1 is the Rare wildcard. Index 2 is the Epic wildcard.
			if (m.type.includes('atk')) {
				requiredCard = m.type.includes('high') ? 'h_attack' : 'l_attack';
				validCards = [requiredCard, 'w_attack', 'w_wild'];
			} else if (m.type.includes('def')) {
				requiredCard = m.type.includes('high') ? 'h_block' : 'l_block';
				validCards = [requiredCard, 'w_block', 'w_wild'];
			} else if (m.type.includes('util')) {
				requiredCard = 'build';
				validCards = [requiredCard, 'w_wild']; // Build only has the Epic wildcard
			}

			if (!this.isTutorial && (this.mode !== 'local' || pNum === 1)) {
				if (!isSealed && !(p.hand && p.hand.some(card => validCards.includes(card.type)))) {
					btn.disabled = true;
					btn.style.opacity = '0.3'; 
				}
			}
			
			let hoverTimeout = null;

			const handleHoverIn = () => {
				if (btn.disabled) return;
				
				if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) {
					return;
				}

				const elapsed = Date.now() - renderStartTime;
				const delay = Math.max(0, 500 - elapsed);

				hoverTimeout = setTimeout(() => {
					if (!btn.matches(':hover')) return;

					if (m.cost > 0) {
						const track = document.getElementById(`p${pNum}-mom-track`);
						if (track) {
							track.querySelectorAll('.mom-pip.filled').forEach((pip, idx, all) => {
								if (idx >= all.length - m.cost) pip.classList.add('pulse-ui');
							});
						}
					}

					if (!this.isTutorial && (this.mode !== 'local' || pNum === 1)) {
						// --- HIGHLIGHT THE EXACT CARD THAT WILL BE CONSUMED ---
						let targetIndex = -1;
						for (let targetType of validCards) {
							targetIndex = p.hand.findIndex(card => card.type === targetType);
							if (targetIndex !== -1) break; // Found the highest priority card!
						}
						
						if (targetIndex !== -1) {
							const cardEl = document.getElementById(`activity-card-${targetIndex}`);
							if (cardEl) cardEl.classList.add('card-sim-hover');
						}
					}
				}, delay);
			};

			const handleHoverOut = () => {
				if (hoverTimeout) clearTimeout(hoverTimeout);
				if (m.cost > 0) {
					const track = document.getElementById(`p${pNum}-mom-track`);
					if (track) track.querySelectorAll('.pulse-ui').forEach(pip => pip.classList.remove('pulse-ui'));
				}
				document.querySelectorAll('.activity-card.card-sim-hover').forEach(el => el.classList.remove('card-sim-hover'));
			};

			btn.addEventListener('mouseenter', handleHoverIn);
			btn.addEventListener('mouseleave', handleHoverOut);
			
			this.attachSmartClick(btn, () => {
				sound.play('click');
				
				// --- FIX 2: KILL THE TIMER ON CLICK ---
				// Prevents the hover effect from bleeding into the next turn if clicked quickly on PC
				if (hoverTimeout) clearTimeout(hoverTimeout);
				
				if (m.cost > 0) {
					const track = document.getElementById(`p${pNum}-mom-track`);
					if (track) track.querySelectorAll('.pulse-ui').forEach(pip => pip.classList.remove('pulse-ui'));
				}
				this.submitMove(pNum, k);
			});

			btn.addEventListener('mouseenter', handleHoverIn);
			btn.addEventListener('mouseleave', handleHoverOut);
			
			this.attachSmartClick(btn, () => {
				sound.play('click');
				if (m.cost > 0) {
					const track = document.getElementById(`p${pNum}-mom-track`);
					if (track) track.querySelectorAll('.pulse-ui').forEach(pip => pip.classList.remove('pulse-ui'));
				}
				this.submitMove(pNum, k);
			});
			
			const groupContainer = document.getElementById(`cg-${m.type.split('_')[0]}`);
			if (groupContainer) groupContainer.appendChild(btn);
		});
		
		const spatialPan = pNum === 1 ? -0.6 : 0.6;
		
		if (this.mode !== 'local' || pNum === 1) {
			this.renderActivityCards(pNum, animateMode, spatialPan);
			const oppNum = pNum === 1 ? 2 : 1;
			const oppPan = oppNum === 1 ? -0.6 : 0.6; 
			const oppAnimateMode = animateMode === 'full' ? 'full' : 'none';
			this.renderActivityCards(oppNum, oppAnimateMode, oppPan, true); 
		}

		// --- THE FIX: ON-RAILS TUTORIAL UI LOCKS (Single Clean Block) ---
		if (this.isTutorial) {
			const controlsContainer = document.getElementById('controls');
			if (controlsContainer) {
				// Dim and disable all buttons by default
				const allBtns = controlsContainer.querySelectorAll('.card-btn');
				allBtns.forEach(btn => {
					btn.style.pointerEvents = 'none';
					btn.style.opacity = '0.3';
				});
				
				let targetId = null;
				if (this.tutorialStep === 4) targetId = 'btn-build';
				if (this.tutorialStep === 6) targetId = 'atk-1'; // Oshidashi (High Attack)
				if (this.tutorialStep === 10 || this.tutorialStep === 11) targetId = 'btn-h_block'; // High Block
				if (this.tutorialStep === 13) targetId = 'atk-2'; // Uwatenage (High Attack)
				
				if (targetId) {
					const targetBtn = document.getElementById(targetId);
					if (targetBtn) {
						targetBtn.style.pointerEvents = 'auto';
						targetBtn.style.opacity = '1';
						targetBtn.classList.add('pulse-ui'); 
					}
				}
			}
		}

		// --- THE FIX: DYNAMIC POSITIONING LOGIC AT THE END ---
		// By placing this here, the UI has completely finished generating 
		// its HTML contents, so updateControlsPosition can accurately measure it!
		let posMode = this.mode;
		if (this.mode === 'online' && typeof net !== 'undefined' && net.side !== 'host') {
			posMode = 'online_guest';
		}
		if (typeof updateControlsPosition === 'function') {
			updateControlsPosition(posMode, pNum);
		}

		// --- NEW: AUTO-SOFT LOCK CHECK ---
		// Online mode is handled by the server timer, so we only check this 
		// for Local/CPU matches to prevent "Infinite Waiting"
		if (this.mode !== 'online') {
			this.checkSoftLock(pNum);
		}
	},
	
	checkSoftLock: function(pNum) {
		const p = pNum === 1 ? this.p1 : this.p2;
		
		// 1. If you still have discards, you aren't truly stuck yet!
		if (this.freeCyclesRemaining > 0) return;

		// 2. Reconstruct the move set for this specific player
		let attackMoves = ['strike', 'sweep', 'thrust', 'throw']; 
		if (this.mode === 'local' && pNum === 2) {
			if (this.p2Loadout && this.p2Loadout.length >= 4) attackMoves = this.p2Loadout;
		} else {
			if (this.playerLoadout && this.playerLoadout.length >= 4) attackMoves = this.playerLoadout;
		}
		const fullDeck = ['build', ...attackMoves, 'h_block', 'l_block'];

		// 3. Check if ANY card in hand can power ANY move you can afford AND that isn't sealed
		const isAnyMovePlayable = fullDeck.some(k => {
			const m = MOVES[k];
			
			// --- THE FIX 1: Check if the move is sealed! ---
			const isSealed = p.disabledMoves && p.disabledMoves.includes(k);

			// If the move doesn't exist, we can't afford it, OR it's sealed, it's unplayable.
			if (!m || p.mom < m.cost || isSealed) return false;

			// --- THE FIX 2: WILD CARD VALIDATION ---
			let req = '';
			let validCards = [];
			
			if (m.type.includes('atk')) {
				req = m.type.includes('high') ? 'h_attack' : 'l_attack';
				validCards = [req, 'w_attack', 'w_wild'];
			} else if (m.type.includes('def')) {
				req = m.type.includes('high') ? 'h_block' : 'l_block';
				validCards = [req, 'w_block', 'w_wild'];
			} else if (m.type.includes('util')) {
				req = 'build';
				validCards = [req, 'w_wild'];
			}

			// Does the player have ANY of the valid cards in their hand?
			return p.hand && p.hand.some(card => validCards.includes(card.type));
		});

		// 4. The Panic Sequence
		if (!isAnyMovePlayable) {
			console.warn("Soft Lock Detected! Player has no playable cards/moves or discards. Forcing Hesitation.");
			
			// Update the UI to explain what's happening
			const msg = document.getElementById('turn-msg');
			if (msg) {
				msg.innerText = "NO MOVES REMAINING...";
				msg.style.color = "var(--accent-red)";
				msg.classList.add('pulse-ui');
			}

			// Lock the UI to prevent any last-second clicks
			const c = document.getElementById('controls');
			if (c) c.style.pointerEvents = 'none';

			// Give the player a moment to process the "soft-lock" before the turn resolves
			setTimeout(() => {
				if (msg) {
					msg.classList.remove('pulse-ui');
					msg.style.color = "";
				}
				if (c) c.style.pointerEvents = 'auto';
				
				// Trigger the 'stall' (Hesitated) move
				this.submitMove(pNum, 'stall');
			}, 1800);
		}
	},

	submitMove: function(pNum, moveKey) {
		const p = pNum === 1 ? this.p1 : this.p2;
		const move = MOVES[moveKey];

		// --- FIND THE EXACT BUTTON ID ---
		let loadout = ['strike', 'sweep', 'thrust', 'throw'];
		if (this.isTutorial) {
			loadout = ['strike', 'sweep', 'thrust', 'throw'];
		} else if (this.mode === 'local' && pNum === 2) {
			if (this.p2Loadout && this.p2Loadout.length >= 4) loadout = this.p2Loadout;
		} else {
			if (this.playerLoadout && this.playerLoadout.length >= 4) loadout = this.playerLoadout;
		}

		let btnId = '';
		if (['build', 'h_block', 'l_block'].includes(moveKey)) {
			btnId = `btn-${moveKey}`;
		} else {
			btnId = `atk-${loadout.indexOf(moveKey)}`;
		}
		
		const selectedBtn = document.getElementById(btnId);

		// Prevent double-firing if the animation is already playing
		if (selectedBtn && selectedBtn.classList.contains('vanish-slow')) return;

		// --- CLIENT-SIDE VALIDATION ---
		if (move.cost > p.mom) {
			console.log("Cannot afford this move!");
			if (selectedBtn) {
				selectedBtn.classList.add('shake-active');
				setTimeout(() => selectedBtn.classList.remove('shake-active'), 300);
			}
			return; 
		}

		// --- ANIMATE CONTROLS OUT ---
		const controls = document.getElementById('controls');
		if (controls) { 
			const allBtns = controls.querySelectorAll('.card-btn');
			allBtns.forEach(btn => {
				btn.disabled = true; 
				if (btn.id === btnId) {
					btn.classList.add('vanish-slow');
				} else {
					btn.classList.add('vanish-fast');
				}
			});
		}
		
		let cardIndex = -1;
		
		// --- ANIMATE HAND EXIT (PRIORITY CONSUMPTION UPDATE) ---
		let requiredCard = '';
		let validCards = [];
		if (move.type.includes('atk')) {
			requiredCard = move.type.includes('high') ? 'h_attack' : 'l_attack';
			validCards = [requiredCard, 'w_attack', 'w_wild'];
		} else if (move.type.includes('def')) {
			requiredCard = move.type.includes('high') ? 'h_block' : 'l_block';
			validCards = [requiredCard, 'w_block', 'w_wild'];
		} else if (move.type.includes('util')) {
			requiredCard = 'build';
			validCards = [requiredCard, 'w_wild'];
		}

		if (p.hand) {
			// Find the exact card index to consume based on rarity priority
			for (let targetType of validCards) {
				cardIndex = p.hand.findIndex(c => c.type === targetType);
				if (cardIndex !== -1) break; // Stop looking once we find the cheapest valid card
			}
			
			const spatialPan = pNum === 1 ? -0.6 : 0.6;

			p.hand.forEach((c, idx) => {
				const cardEl = document.getElementById(`activity-card-${idx}`);
				if (cardEl) {
					if (cardEl.classList.contains('discarding')) return; 
					
					const isPoppedUp = cardEl.classList.contains('card-sim-hover');
					
					cardEl.classList.remove(
						'card-sim-hover', 
						'card-enter-cascade', 
						'card-draw-single',
						'slide-over-bounce', 
						'is-dragging'        
					); 
					
					if (idx === cardIndex) {
						cardEl.style.animationDelay = '0s'; 
						
						if (isPoppedUp) {
							cardEl.classList.add('card-play-out'); 
						} else {
							cardEl.classList.add('card-play-out-fast'); 
						}
						
						if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan); 
					} else {
						cardEl.style.animationDelay = `${idx * 0.03}s`;
						cardEl.classList.add('card-swoop-out');
						if (typeof sound !== 'undefined') {
							setTimeout(() => sound.play('card_flick', spatialPan), idx * 30);
						}
					}
				}
			});
		}

		// --- DELAY SUBMISSION TO LET THE ANIMATION PLAY ---
		setTimeout(() => {
			
			// --- SPEND THE CARD AND DRAW ---
			if (p.hand && cardIndex !== -1) {
				const spentCard = p.hand.splice(cardIndex, 1)[0];
				if (!p.discardPile) p.discardPile = [];
				p.discardPile.push(spentCard);
				
				if (typeof this.drawCards === 'function') {
					const cardsNeeded = 5 - p.hand.length;
					if (cardsNeeded > 0) {
						this.drawCards(pNum, cardsNeeded);
					}
				}
			}

			// 1. Online Check
			if (this.mode === 'online') {
				const myPlayer = net.side === 'host' ? this.p1 : this.p2;
				myPlayer.move = moveKey;
				if (typeof gyoji !== 'undefined' && gyoji.stopIdleTimer) gyoji.stopIdleTimer();
				net.sendMove(moveKey, cardIndex);
				
				if (controls) {
					controls.innerHTML = '<div style="background: rgba(255,255,255,0.95); padding: 12px 20px; border-radius: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); font-weight: bold; font-family: var(--font-ui); color: var(--ink-color); pointer-events: auto;">Waiting for opponent...</div>';
				}
				
				net.checkReady();
				return;
			}

			// 2. Tutorial Fix
			if (this.isTutorial) {
				const overlay = document.getElementById('tutorial-overlay');
				if (overlay) overlay.classList.add('hidden');
			}

			// 3. Standard Local/CPU Logic
			if (pNum === 1) {
				this.p1.move = moveKey;
				if (this.mode === 'local') {
					this.startTurn(2);
				} else if (this.mode === 'cpu') {
					this.history.push(moveKey); 
					this.startTurn(2); 
				}
			} else {
				this.p2.move = moveKey;
				this.resolveTurn();
			}
		}, 450);
	},
	
	// =========================================
	// RESOURCE DECK SYSTEM
	// =========================================

	shuffleDeck: function(deckArray) {
		// Standard Fisher-Yates shuffle
		for (let i = deckArray.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[deckArray[i], deckArray[j]] = [deckArray[j], deckArray[i]];
		}
	},

	initDeckState: function(playerNum) {
		const p = playerNum === 1 ? this.p1 : this.p2;

		// --- NEW: THE SCRIPTED TUTORIAL DECK ---
		if (this.isTutorial) {
			p.hand = [];
			p.discardPile = [];
			let deckKeys = [];
			if (playerNum === 1) {
				deckKeys = ['build', 'h_attack', 'h_block', 'h_block', 'h_attack', 'build', 'build'];
			} else {
				deckKeys = ['h_attack', 'h_block', 'h_attack', 'h_attack', 'build', 'build', 'build'];
			}
			deckKeys.reverse();
			p.drawPile = deckKeys.map(key => {
				const template = this.RESOURCE_CARDS[key] || { name: key, desc: '' };
				return { type: key, name: template.name, desc: template.desc };
			});
			this.drawCards(playerNum, 5);
			return;
		}

		// --- CRITICAL FIX: Hard-save the starter deck & Purge Garbage Cards! ---
		if (playerNum === 1 && this.career) {
			let needsSave = false;

			if (this.career.cardCollection) {
				Object.keys(this.career.cardCollection).forEach(key => {
					if (!this.RESOURCE_CARDS[key]) {
						console.warn(`🧹 Purged illegal card from collection: ${key}`);
						delete this.career.cardCollection[key];
						needsSave = true;
					}
				});
			} else {
				this.career.cardCollection = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
				needsSave = true;
			}

			if (this.career.activeDeck) {
				const originalSize = this.career.activeDeck.length;
				this.career.activeDeck = this.career.activeDeck.filter(key => this.RESOURCE_CARDS[key]);
				
				if (this.career.activeDeck.length !== originalSize) {
					console.warn(`🧹 Purged ${originalSize - this.career.activeDeck.length} illegal cards from the active deck.`);
					needsSave = true;
				}
			}

			const min = this.MIN_DECK_SIZE || 12;
			if (!this.career.activeDeck || this.career.activeDeck.length < min) {
				this.career.activeDeck = [];
				const defaultCounts = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
				Object.keys(defaultCounts).forEach(type => {
					for (let i = 0; i < defaultCounts[type]; i++) this.career.activeDeck.push(type);
				});
				needsSave = true;
			}

			if (needsSave && typeof this.saveCareer === 'function') {
				this.saveCareer();
			}
		}
		// -------------------------------------------------------------------------

		let deckKeys = [];
		const min = this.MIN_DECK_SIZE || 12;
		const max = this.MAX_DECK_SIZE || 64;
		
		if (playerNum === 1 && this.career && this.career.activeDeck && 
			this.career.activeDeck.length >= min && this.career.activeDeck.length <= max) {
			deckKeys = [...this.career.activeDeck];
		} else {
			// --- THE CPU DYNAMIC DECK GENERATOR ---
			// Ensure a baseline of 15 functional cards so the CPU isn't starved early
			const defaultCounts = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
			Object.keys(defaultCounts).forEach(type => {
				for (let i = 0; i < defaultCounts[type]; i++) deckKeys.push(type);
			});

			if (playerNum === 2 && this.mode === 'cpu') {
				const tier = this.cpuDiff !== undefined ? Math.max(0, Math.min(5, this.cpuDiff)) : 0;
				
				// Reusing your Loot Probabilities
				const lootTables = [
					{ l: 0.00, e: 0.00, r: 0.05 }, // Tier 0
					{ l: 0.00, e: 0.01, r: 0.09 }, // Tier 1
					{ l: 0.0025, e: 0.045, r: 0.1025 }, // Tier 2
					{ l: 0.0025, e: 0.065, r: 0.1825 }, // Tier 3
					{ l: 0.0075, e: 0.1325, r: 0.26 }, // Tier 4
					{ l: 0.01, e: 0.22, r: 0.37 }  // Tier 5
				];
				const probs = lootTables[tier];

				const rarePool = []; const epicPool = []; const legPool = [];
				for (let key in this.RESOURCE_CARDS) {
					let rarity = this.RESOURCE_CARDS[key].rarity || 'common';
					if (rarity === 'rare') rarePool.push(key);
					else if (rarity === 'epic') epicPool.push(key);
					else if (rarity === 'legendary') legPool.push(key);
				}

				// Generate between 0 and 49 extra cards (Total deck size 15 to 64)
				const extraCards = Math.floor(Math.random() * ((max - 15) + 1));
				
				for(let i = 0; i < extraCards; i++) {
					let rarityRoll = Math.random();
					let selectedRarity = 'common';
					
					if (rarityRoll < probs.l) selectedRarity = 'legendary';
					else if (rarityRoll < probs.l + probs.e) selectedRarity = 'epic';
					else if (rarityRoll < probs.l + probs.e + probs.r) selectedRarity = 'rare';

					if (selectedRarity === 'legendary' && legPool.length === 0) selectedRarity = 'epic';
					if (selectedRarity === 'epic' && epicPool.length === 0) selectedRarity = 'rare';
					if (selectedRarity === 'rare' && rarePool.length === 0) selectedRarity = 'common';

					if (selectedRarity === 'common') {
						let catRoll = Math.random();
						if (catRoll < 0.33) deckKeys.push(Math.random() > 0.5 ? 'h_attack' : 'l_attack');
						else if (catRoll < 0.66) deckKeys.push(Math.random() > 0.5 ? 'h_block' : 'l_block');
						else deckKeys.push('build');
					} else {
						let pool = (selectedRarity === 'rare') ? rarePool : (selectedRarity === 'epic' ? epicPool : legPool);
						deckKeys.push(pool[Math.floor(Math.random() * pool.length)]);
					}
				}
			}
			// --------------------------------------
		}

		// --- BULLETPROOF FILTER ---
		deckKeys = deckKeys.filter(key => this.RESOURCE_CARDS[key]);

		p.drawPile = deckKeys.map(key => {
			const template = this.RESOURCE_CARDS[key];
			return { type: key, name: template.name, desc: template.desc };
		});

		p.hand = [];
		p.discardPile = [];

		this.shuffleDeck(p.drawPile);
		this.isNotChankoDraw = true; 
    
		this.drawCards(playerNum, 5);
		
		// Setup is now complete!
		this.isNotChankoDraw = false;
	},

	drawCards: function(playerNum, amount) {
		const p = playerNum === 1 ? this.p1 : this.p2;

		for (let i = 0; i < amount; i++) {
			// RESHUFFLE LOGIC
			if (p.drawPile.length === 0) {
				if (p.discardPile.length === 0) {
					console.log(`P${playerNum} has no cards left in deck OR discard!`);
					break; 
				}
				p.drawPile = [...p.discardPile];
				p.discardPile = [];
				this.shuffleDeck(p.drawPile);
			}

			// Draw the top card
			const drawnCard = p.drawPile.pop();
			p.hand.push(drawnCard);
		}
		// Notice: No forced visual render here anymore! The animation handlers take care of it.
		// --- ACHIEVEMENT WATCHER: HAND STATE ---
		if (playerNum === 1) {
			const p = this.p1;
			// 1. Hyakuman (8+ cards)
			if (p.hand.length >= 8) this.unlockAchievement('hyakuman');

			// 2. Goshiki (All 4 rarities)
			const rarities = new Set(p.hand.map(c => this.RESOURCE_CARDS[c.type].rarity || 'common'));
			if (rarities.has('common') && rarities.has('rare') && rarities.has('epic') && rarities.has('legendary')) {
				this.unlockAchievement('goshiki');
			}

			// 3. Shin-Gi-Tai (All Legendary)
			// Only check if hand is at least 3 cards to prevent early-game fluke unlocks
			if (p.hand.length >= 3) {
				const allLegendary = p.hand.every(c => (this.RESOURCE_CARDS[c.type].rarity || 'common') === 'legendary');
				if (allLegendary) this.unlockAchievement('shin_gi_tai');
			}
			// 2. THE FIX: Manpuku Achievement (Draw Source Check)
			// We ONLY track this if the match is fully initialized 
			// AND if the draw isn't a full hand replacement (optional check)
			if (!this.isNotChankoDraw) {
				this.turnDrawCount = (this.turnDrawCount || 0) + amount;				
				if (this.turnDrawCount >= 4) {
					this.unlockAchievement('manpuku');
				}
			}
		}
	},
	
	// NEW: Added isSwipeUp parameter with a default of false
	cycleCard: function(playerNum, handIndex, event, isSwipeUp = false) {
		// Just check if it's locked, don't lock it yet!
		if (this.isCycling) return;
		
		if (event) event.stopPropagation();
		const spatialPan = playerNum === 1 ? -0.6 : 0.6;
		
		// --- THE FIX: ALLOW GUEST TO DISCARD ---
		// We dynamically determine who the "Local Player" is before blocking!
		const localPNum = (this.mode === 'online' && typeof net !== 'undefined' && net.side === 'join') ? 2 : 1;
		if (this.mode !== 'local' && playerNum !== localPNum) return;
		
		if (this.isTutorial) return;
		
		const p = playerNum === 1 ? this.p1 : this.p2;
		if (!p.hand || p.hand.length <= handIndex) return;

		// Check cycles remaining
		if (!this.freeCyclesRemaining || this.freeCyclesRemaining <= 0) {
			const targetEl = isSwipeUp ? 
				document.getElementById(`activity-card-${handIndex}`) : 
				document.querySelector(`#activity-card-${handIndex} .card-cycle-btn`);
			if (targetEl) {
				targetEl.classList.add('shake-active');
				setTimeout(() => targetEl.classList.remove('shake-active'), 300);
			}
			if (typeof sound !== 'undefined') sound.play('qte_fail');
			// We return here, safely aborting without ever having locked the engine!
			return;
		}
		
		// --- ACHIEVEMENT WATCHER: CYCLING ---
		if (playerNum === 1) {
			this.turnCyclesCount = (this.turnCyclesCount || 0) + 1;
			if (this.turnCyclesCount >= 5) this.unlockAchievement('shunshin');
			
			// Tracking for Aizome (Waki Bonus usage)
			if (p.hand[handIndex].type === 'waki_ga_katai') {
				this.wakiMatchUsage = (this.wakiMatchUsage || 0) + 1;
				if (this.wakiMatchUsage >= 3) this.unlockAchievement('aizome');
			}

			// Tracking for Osoji (5 card sweep)
			if (p.hand[handIndex].type === 'osoji' && p.hand.length >= 8) {
				this.unlockAchievement('soji');
			}
		}

		// Tracking for Tenpuku (Resetting opponent's large hand)
		if (playerNum === 1 && p.hand[handIndex].type === 'shikiri_naoshi') {
			if (this.p2.hand.length >= 5) this.unlockAchievement('tenpuku');
		}

		// Tracking for Hyōhyō (Win without cycling)
		if (playerNum === 1) this.playerHasCycledThisMatch = true;

		// --- THE FIX: LOCK THE ENGINE HERE ---
		// We survived all the checks, the discard is happening, lock the engine!
		this.isCycling = true;

		// --- NEW: LOG THE DISCARD TO THE BATTLE FEED ---
		const cardType = p.hand[handIndex].type;
		const cardData = this.RESOURCE_CARDS[cardType] || p.hand[handIndex] || {};
		const cardName = cardData.name || cardType;
		
		// FIX 1: Cast a wider net in case the property was named differently!
		let descText = cardData.desc || cardData.description || cardData.effect || cardData.text || "";
		
		// FIX 2: Case-insensitive Regex! This catches "Discard:", "discard", "DISCARD", etc.
		if (/discard/i.test(descText)) {
			// THE FIX: Trigger the animation, but tell it to suppress its internal log!
			if (typeof this.activateCardEffect === 'function') {
				this.activateCardEffect(playerNum, cardType, 0, 1, true);
			}
			descText = `<strong style="background: rgba(0, 0, 0, 0.75); color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.9em; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); margin-left: 4px;">${descText}</strong>`;
		}
		
		const pLabel = playerNum === 1 ? 'P1' : 'P2';
		this.log(`<span style="color:#aaa; font-size:0.9em;">${pLabel} discards <em>${cardName}</em>. ${descText}</span>`);
		// ----------------------------------------------
		
		// --- THE FIX: WAKI GA KATAI & PERSISTENT BANK TRACKING ---
		if (p.hand[handIndex].type === 'waki_ga_katai' && !this.wakiBonusUsed) {
			// Grant 2 bonus cycles to both the temporary pool and the persistent bank! 
			this.freeCyclesRemaining += 2; 
			p.bankedCycles = (p.bankedCycles || 0) + 2; 
			this.wakiBonusUsed = true; // Lock it out for the rest of the turn
		}
		
		if (this.mode === 'online' && typeof net !== 'undefined' && net.sendCycle) {
            net.sendCycle(handIndex, p.hand[handIndex].type);
        }

		// Deduct from both pools!
		this.freeCyclesRemaining--;
		p.bankedCycles = Math.max(0, (p.bankedCycles || 0) - 1);
		// ---------------------------------------------------------
		
		// Optional: Play a special sound if a rare effect triggers, otherwise normal flick
		if (p.hand[handIndex].type === 'waki_ga_katai') {
			if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan); 
		} else {
			if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan);
		}

		const cardEl = document.getElementById(`activity-card-${handIndex}`);
		if (cardEl) {
			// --- STEP A: CAPTURE CURRENT POSITION ---
			const currentY = isSwipeUp ? (cardEl.style.translate.split(' ')[1] || '0px') : '0px';
			
			// --- STEP B: PREPARE THE SNAPSHOT ---
			cardEl.classList.remove('is-dragging', 'card-sim-hover');
			cardEl.style.animation = 'none'; 
			cardEl.style.transform = `translateY(${currentY}) rotateY(0deg)`;
			void cardEl.offsetWidth;

			// --- STEP C: TRIGGER THE DISCARD ---
			cardEl.classList.add('discarding');

			// Mid-flight Texture Swap
			setTimeout(() => {
				const themeClass = `theme-card-back ${playerNum === 1 ? 'p1-back' : 'p2-back'}`;
				const body = cardEl.querySelector('.card-body');
				if (body) {
					body.className = `card-body ${themeClass}`;
					body.innerHTML = `
						<div class="card-inner">
							<div class="card-icons icon-layout-1">
								<svg class="hero-crest" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
									<circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" stroke-width="8" opacity="0.6"/>
									<g transform="translate(100,100)">
										<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" />
										<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(72)" />
										<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(144)" />
										<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(216)" />
										<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(288)" />
										<circle cx="0" cy="0" r="10" fill="currentColor" />
									</g>
								</svg>
							</div>
						</div>`;
				}
			}, 200);
		}

		// --- STEP D: UPDATE SIBLINGS & HAND ---
		for (let i = handIndex + 1; i < p.hand.length; i++) {
			const siblingCard = document.getElementById(`activity-card-${i}`);
			if (siblingCard) {
				siblingCard.classList.remove('card-enter-cascade', 'card-draw-single');
				siblingCard.style.animationDelay = '0s'; 
				siblingCard.classList.add('slide-over-bounce');
			}
		}

		setTimeout(() => {
			const discarded = p.hand.splice(handIndex, 1)[0];
			if (!p.discardPile) p.discardPile = [];
			p.discardPile.push(discarded);
			
			// --- NEKODAMASHI DEBUFF LOGIC ---
			if (discarded.type === 'nekodamashi') {
				const targetNum = playerNum === 1 ? 2 : 1;
				const targetP = targetNum === 1 ? this.p1 : this.p2;
				targetP.pendingCyclePenalty = (targetP.pendingCyclePenalty || 0) + 1;
				if (typeof this.renderDebuffs === 'function') this.renderDebuffs(targetNum);
			}

			// --- NEW: SHIKIRI-NAOSHI (OPPONENT RESET) ---
			if (discarded.type === 'shikiri_naoshi') {
				const targetNum = playerNum === 1 ? 2 : 1;
				const targetP = targetNum === 1 ? this.p1 : this.p2;
				targetP.pendingShikiriPenalty = (targetP.pendingShikiriPenalty || 0) + 1;
				if (typeof this.renderDebuffs === 'function') this.renderDebuffs(targetNum);
			}
			
			// --- MULTI-DRAW & OSOJI SWEEP LOGIC (SELF) ---
			let drawCount = 0;
			if (discarded.type === 'osoji') {
				this.isNotChankoDraw = true;
				drawCount = p.hand.length + 1; 
				p.discardPile.push(...p.hand);
				p.hand = [];
				this.isNotChankoDraw = false;
			} else if (discarded.type === 'chankonabe') {
				drawCount = 3;
			} else {
				if (p.hand.length < 5) drawCount = 1;
			}
			
			if (drawCount > 0) this.drawCards(playerNum, drawCount);
			
			let animMode = 'refresh'; 
			if (drawCount > 1) animMode = 'full';
			else if (drawCount === 1) animMode = 'draw-last';
			
			this.renderControls(playerNum, animMode);
			this.isCycling = false; 
		}, 850);
	},

	cycleOpponentCard: async function(oppNum, handIndex) {
		const spatialPan = oppNum === 1 ? -0.6 : 0.6;
		const p = oppNum === 1 ? this.p1 : this.p2;
		
		if (!p.hand || p.hand.length <= handIndex) return;

		// --- THE FIX: KEEP OPPONENT BANK SYNCED ---
		if (p.hand[handIndex].type === 'waki_ga_katai') {
			p.bankedCycles = (p.bankedCycles || 0) + 2;
		}
		p.bankedCycles = Math.max(0, (p.bankedCycles || 0) - 1);
		// ------------------------------------------

		const cardElement = document.getElementById(`opp-card-${handIndex}`);
		
		// If the element doesn't exist, instantly process the data without animation
		if (!cardElement) {
			this._processOpponentDiscardData(p, oppNum, handIndex, spatialPan);
			return; 
		}
			
		// 1. Start the 3D Flip
		cardElement.style.animationDelay = '0s'; 
		cardElement.classList.add('flip-reveal-half');
		if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan);

		// --- RETURN A PROMISE SO THE AI LOOP WAITS ---
		return new Promise(resolve => {
			// 2. The Mid-Flip Swap
			setTimeout(() => {
				// Safety check: Did the hand change while we were waiting?
				if (!p.hand || p.hand.length <= handIndex) {
					resolve();
					return;
				}

				const activeCard = p.hand[handIndex];
				const data = this.RESOURCE_CARDS[activeCard.type] || { type: activeCard.type };
				
				const realTheme = data.theme || 'theme-build';
				const realLayout = data.layout || 'icon-layout-1';
				const realText = data.shortName || activeCard.type.replace('_', ' ').toUpperCase();
				
				let realIcons = '';
				if (data.svg) {
					realIcons = data.svg;
				} else if (data.iconKey) {
					realIcons = `<div class="card-icon-slot">${typeof MOVE_ICONS !== 'undefined' && MOVE_ICONS[data.iconKey] ? MOVE_ICONS[data.iconKey] : '?'}</div>`;
				} else if (data.isDynamicIcon && typeof MOVE_ICONS !== 'undefined') {
					const moveType = activeCard.type === 'h_attack' ? 'strike' : 'sweep';
					realIcons = `<div class="card-icon-slot">${MOVE_ICONS[moveType] || '?'}</div>`;
				}
				
				const body = cardElement.querySelector('.card-body');
				body.className = `card-body ${realTheme}`;
				body.innerHTML = `
					<div class="card-inner">
						<div class="card-icons ${realLayout}">${realIcons}</div>
						<div class="activity-type">${realText}</div>
					</div>
				`;

				cardElement.classList.remove('flip-reveal-half');
				cardElement.classList.add('flip-reveal-full');

				// --- LOG THE OPPONENT DISCARD ---
				const cardType = activeCard.type;
				const cardName = data.name || cardType;
				let descText = data.desc || data.description || data.effect || data.text || "";
				
				if (/discard/i.test(descText)) {
					if (typeof this.activateCardEffect === 'function') {
						this.activateCardEffect(oppNum, cardType, 0, 1, true);
					}
					descText = `<strong style="background: rgba(0, 0, 0, 0.75); color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.9em; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); margin-left: 4px;">${descText}</strong>`;
				}
				
				const pLabel = oppNum === 1 ? 'P1' : 'P2';
				this.log(`<span style="color:#aaa; font-size:0.9em;">${pLabel} discards <em>${cardName}</em>. ${descText}</span>`);

				// 3. Pause for drama
				setTimeout(() => {
					cardElement.classList.remove('flip-reveal-full');
					cardElement.classList.add('opp-discard-shoot');
					
					for (let i = handIndex + 1; i < p.hand.length; i++) {
						const sibling = document.getElementById(`opp-card-${i}`);
						if (sibling) {
							sibling.style.animationDelay = '0s';
							sibling.classList.add('slide-over-bounce');
						}
					}

					// 4. Resolve Data and Draw a New Card
					setTimeout(() => {
						const container = document.getElementById('opponent-card-container');
						const isExiting = container && container.querySelector('.card-swoop-out, .card-play-out');
						
						if (!isExiting) {
							this._processOpponentDiscardData(p, oppNum, handIndex, spatialPan);
						}
						// Resolve the promise so the AI knows it can continue!
						resolve();
					}, 750);

				}, 600);
			}, 200); 
		});
	},

	// Extracted data logic to keep it DRY and clean
	_processOpponentDiscardData: function(p, oppNum, handIndex, spatialPan) {
		const discarded = p.hand.splice(handIndex, 1)[0];
		if (!p.discardPile) p.discardPile = [];
		p.discardPile.push(discarded);

		if (discarded.type === 'nekodamashi') {
			const targetNum = oppNum === 1 ? 2 : 1;
			const targetP = targetNum === 1 ? this.p1 : this.p2;
			targetP.pendingCyclePenalty = (targetP.pendingCyclePenalty || 0) + 1;
			if (typeof this.renderDebuffs === 'function') this.renderDebuffs(targetNum);
		}

		// --- NEW: SHIKIRI-NAOSHI (OPPONENT RESET) ---
		if (discarded.type === 'shikiri_naoshi') {
				const targetNum = oppNum === 1 ? 2 : 1;
				const targetP = targetNum === 1 ? this.p1 : this.p2;
				targetP.pendingShikiriPenalty = (targetP.pendingShikiriPenalty || 0) + 1;
				if (typeof this.renderDebuffs === 'function') this.renderDebuffs(targetNum);
			}

		let drawCount = 0;
		if (discarded.type === 'osoji') {
			drawCount = p.hand.length + 1; 
			p.discardPile.push(...p.hand);
			p.hand = [];
		} else if (discarded.type === 'chankonabe') {
			drawCount = 3;
		} else {
			if (p.hand.length < 5) drawCount = 1;
		}

		if (drawCount > 0) this.drawCards(oppNum, drawCount);
		
		let animMode = 'refresh';
		if (drawCount > 1) animMode = 'full';
		else if (drawCount === 1) animMode = 'draw-last';

		this.renderActivityCards(oppNum, animMode, spatialPan, true);
	},

	renderActivityCards: function(playerNum, animateMode = 'full', spatialPan = 0, isOpponent = false) {
		const p = playerNum === 1 ? this.p1 : this.p2;
		
		// --- THE MISSING WIRE: AUTO-INITIALIZE CPU DECK ---
		if (!p.hand || p.hand.length === 0) {
			if (typeof this.initDeckState === 'function') {
				this.initDeckState(playerNum);
			} else {
				return; 
			}
		}

		// --- NEW: SILENT FIFO TRACKER ---
		// Automatically stamp every card with a chronological ID the first time it renders
		if (!p._drawCounter) p._drawCounter = 0;
		p.hand.forEach(c => {
			if (c._drawId === undefined) c._drawId = p._drawCounter++;
		});

		// --- NEW: THE GLOBAL SORTING EVENT LISTENER ---
		if (!this._sortListenerAdded) {
			this._sortListenerAdded = true;
			
			const handleSortToggle = (e) => {
				if ((e.type === 'pointerdown' && e.button === 1) || (e.type === 'keydown' && e.code === 'ShiftLeft')) {
					
					if (e.type === 'pointerdown') e.preventDefault(); 
					
					const localPNum = (this.mode === 'online' && typeof net !== 'undefined' && net.side === 'join') ? 2 : 1;
					const activeP = localPNum === 1 ? this.p1 : this.p2;
					
					// If they are already sorting, or have no hand, ignore the input!
					if (!activeP || !activeP.hand || activeP.hand.length <= 1 || this._isSorting) return;

					this._isSorting = true; // Lock the animation state

					activeP.sortMode = ((activeP.sortMode || 0) + 1) % 3;
					
					if (activeP.sortMode === 0) { 
						activeP.hand.sort((a, b) => a._drawId - b._drawId);
					} else if (activeP.sortMode === 1) { 
						const rarityVal = { 'legendary': 4, 'epic': 3, 'rare': 2, 'common': 1 };
						activeP.hand.sort((a, b) => {
							const rA = rarityVal[(this.RESOURCE_CARDS[a.type] || {}).rarity || 'common'];
							const rB = rarityVal[(this.RESOURCE_CARDS[b.type] || {}).rarity || 'common'];
							if (rA !== rB) return rB - rA; 
							return a.type.localeCompare(b.type);
						});
					} else if (activeP.sortMode === 2) { 
						const counts = {};
						activeP.hand.forEach(c => counts[c.type] = (counts[c.type] || 0) + 1);
						activeP.hand.sort((a, b) => {
							if (counts[a.type] !== counts[b.type]) return counts[b.type] - counts[a.type]; 
							return a.type.localeCompare(b.type);
						});
					}

					// --- THE FIX: INDIVIDUAL CARD EXIT CASCADE ---
					const container = document.getElementById('activity-card-container');
					if (container) {
						const domCards = container.querySelectorAll('.activity-card');
						
						domCards.forEach((cardEl, idx) => {
							// 1. Strip the old entrance classes so they don't fight the exit class
							cardEl.classList.remove('card-enter-cascade', 'card-draw-single', 'slide-over-bounce');
							
							// 2. Briefly kill the animation and force a browser reflow
							cardEl.style.transition = 'none';
							cardEl.style.animation = 'none';
							void cardEl.offsetWidth; 
							
							// 3. THE FIX: Clear the inline 'none' override so CSS classes work again!
							cardEl.style.animation = ''; 
							cardEl.style.animationDuration = ''; // Clear any inline duration overrides
							
							// 4. Apply the staggered exit
							cardEl.style.animationDelay = `${idx * 0.03}s`;
							cardEl.classList.add('card-swoop-out');
							
							// Stagger the exit sounds to match!
							setTimeout(() => {
								if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan, 0.8);
							}, idx * 30);
						});

						// Wait for the longest exit animation to finish before dealing the new hand
						const maxExitTime = (domCards.length * 30) + 250; 
						
						setTimeout(() => {
							// Using 'full' perfectly re-uses your staggered entrance logic!
							this.renderActivityCards(localPNum, 'full', spatialPan);
							
							// Unlock the input after the entrance cascade finishes
							setTimeout(() => {
								this._isSorting = false;
							}, (activeP.hand.length * 50) + 300);
							
						}, maxExitTime);
					} else {
						this._isSorting = false;
					}
				}
			};

			window.addEventListener('keydown', handleSortToggle);
			window.addEventListener('pointerdown', handleSortToggle);
		}
		// ---------------------------------------------

		// --- DETERMINE CONTAINER ---
		let containerId = isOpponent ? 'opponent-card-container' : 'activity-card-container';
		let container = document.getElementById(containerId);
		
		if (isOpponent && !container) {
			container = document.createElement('div');
			container.id = 'opponent-card-container';
			const gameUI = document.getElementById('game-ui') || document.body;
			gameUI.appendChild(container); 
		}
		
		if (!container) return;
		container.innerHTML = ''; 

		// --- DYNAMIC CSS CONTAINER ALIGNMENT ---
		const isRightSide = spatialPan > 0;
		if (isOpponent) {
			if (isRightSide) {
				container.style.right = '20px';
				container.style.left = 'auto';
			} else {
				container.style.left = '20px';
				container.style.right = 'auto';
			}
		}

		const swoopX = isRightSide ? '250px' : '-250px';
		const drawX = isRightSide ? '-30px' : '30px';
		const swoopRot = isRightSide ? '15deg' : '-15deg';

		// --- 1. DETERMINE PLAYER LOADOUT ---
		let attackMoves = ['strike', 'sweep', 'thrust', 'throw']; 
		if (this.isTutorial) {
			attackMoves = ['strike', 'sweep', 'thrust', 'throw'];
		} else if (this.mode === 'local' && playerNum === 2) {
			if (this.p2Loadout && this.p2Loadout.length >= 4) attackMoves = this.p2Loadout;
		} else {
			if (this.playerLoadout && this.playerLoadout.length >= 4) attackMoves = this.playerLoadout;
		}

		let highAttacks = [];
		let lowAttacks = [];
		attackMoves.forEach(moveKey => {
			if (MOVES[moveKey]) {
				if (MOVES[moveKey].type.includes('high')) highAttacks.push(moveKey);
				else if (MOVES[moveKey].type.includes('low')) lowAttacks.push(moveKey);
			}
		});
		
		const totalCards = p.hand.length;
        const centerIndex = (totalCards - 1) / 2;

        const isMobile = window.innerWidth <= 768;
        const maxStandardCards = isMobile ? 4 : 6;
        const squeezeRate = isMobile ? 12 : 7.5;
        const maxSqueeze = isMobile ? -65 : -55;
        
        const overlapPx = totalCards > maxStandardCards 
            ? Math.max(maxSqueeze, -15 - ((totalCards - maxStandardCards) * squeezeRate)) 
            : -15;
        container.style.setProperty('--card-overlap', `${overlapPx}px`);

        const pushPx = Math.abs(overlapPx) + 5; 
        container.style.setProperty('--card-push', `${pushPx}px`);

        const maxRotEdge = 30; 
        const rotStep = centerIndex > 0 ? Math.min(6, maxRotEdge / centerIndex) : 6;
        const maxYDrop = 35; 
        const yStep = centerIndex > 0 ? Math.min(2, maxYDrop / Math.pow(centerIndex, 2)) : 2;

        // --- 3. RENDER CARDS ---
        p.hand.forEach((card, index) => {
            const offset = index - centerIndex;
            const rotation = offset * rotStep; 
            const yShift = Math.pow(offset, 2) * yStep; 
            
            let animClass = '';
			let animStyle = `--fan-rot: ${rotation}deg; --fan-y: ${yShift}px; --swoop-x: ${swoopX}; --draw-x: ${drawX}; --swoop-rot: ${swoopRot}; `;

			if (animateMode === 'full') {
				animClass = 'card-enter-cascade';
				animStyle += `animation-delay: ${index * 0.05}s, ${index * -0.4}s;`;
			} else if (animateMode === 'draw-last' && index === p.hand.length - 1) {
				animClass = 'card-draw-single';
				animStyle += `animation-delay: 0s, ${index * -0.4}s;`;
			} else if (animateMode === 'sort') {
				// Fast fan-out to accompany the shuffle drop
				animClass = 'card-enter-cascade';
				animStyle += `animation-duration: 0.15s, 4s; animation-delay: ${index * 0.02}s, ${index * -0.4}s;`;
			} else {
				animStyle += `animation-delay: ${index * -0.4}s;`;
			}

			const data = this.RESOURCE_CARDS[card.type] || { type: card.type };

			// --- UNIVERSAL DATA-DRIVEN RENDERER ---
			let themeClass = data.theme || 'theme-build';
			let layoutClass = data.layout || 'icon-layout-1';
			let typeText = data.shortName || card.type.replace('_', ' ').toUpperCase();
			let cardIconsHTML = '';
			let rarityClass = data.rarity ? `rarity-${data.rarity}` : 'rarity-common';

			if (data.isDynamicIcon) {
				const missingX = `<div class="card-icon-slot"><svg viewBox="0 0 24 24" stroke="var(--accent-red)" stroke-width="3" fill="none" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></div>`;
				if (card.type === 'h_attack') {
					if (highAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { layoutClass = `icon-layout-${Math.min(highAttacks.length, 4)}`; highAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
				} else if (card.type === 'l_attack') {
					if (lowAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { layoutClass = `icon-layout-${Math.min(lowAttacks.length, 4)}`; lowAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
				} else if (card.type === 'w_attack') {
					// NEW: Draw all loaded attacks (up to 4) onto the Wild Attack card!
					const allAttacks = [...highAttacks, ...lowAttacks];
					if (allAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { 
						layoutClass = `icon-layout-${Math.min(allAttacks.length, 4)}`; 
						allAttacks.slice(0, 4).forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); 
					}
				}
			} else if (data.svg) {
				cardIconsHTML = data.svg;
			} else if (data.iconKey) {
				cardIconsHTML = `<div class="card-icon-slot">${MOVE_ICONS[data.iconKey] || '?'}</div>`;
			}

			// --- THE OPPONENT MASK ---
			const realTheme = themeClass;
			const safeIcons = cardIconsHTML.replace(/"/g, '&quot;'); 
			const realText = typeText;

			if (isOpponent) {
				themeClass = `theme-card-back ${playerNum === 1 ? 'p1-back' : 'p2-back'}`;
				layoutClass = 'icon-layout-1';
				typeText = '';
				cardIconsHTML = `
					<svg class="hero-crest" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
						<circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" stroke-width="8" opacity="0.6"/>
						<g transform="translate(100,100)">
							<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" />
							<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(72)" />
							<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(144)" />
							<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(216)" />
							<path d="M0,-80 C20,-40 30,-20 0,0 C-30,-20 -20,-40 0,-80" fill="currentColor" transform="rotate(288)" />
							<circle cx="0" cy="0" r="10" fill="currentColor" />
						</g>
					</svg>`;
			}

			let tooltipHTML = '';
			if (!isOpponent) {
				const cardName = data.name || typeText;
				let cardDesc = data.desc || data.description || '';
				const cardRarity = data.rarity ? data.rarity.toUpperCase() : 'COMMON';
				
				if (card.type === 'waki_ga_katai' && this.wakiBonusUsed) {
					cardDesc = `<span style="text-decoration: line-through; opacity: 0.5;">${cardDesc}</span>`;
				}
				
				let rarityColor = '#ccc'; 
				if (data.rarity === 'rare') rarityColor = '#3498db';
				if (data.rarity === 'epic') rarityColor = '#9b59b6';
				if (data.rarity === 'legendary') rarityColor = '#f1c40f';

				tooltipHTML = `
					<div class="card-tooltip" style="bottom: 110%;">
						<span class="card-name">${cardName}</span>
						${cardDesc ? `<span class="card-cost" style="white-space: normal; text-align: center;">${cardDesc}</span>` : ''}
						<span class="card-type" style="color: ${rarityColor};">${cardRarity}</span>
					</div>
				`;
			}

			const idPrefix = isOpponent ? 'opp-card-' : 'activity-card-';
			
			let cycleText = `x${this.freeCyclesRemaining !== undefined ? this.freeCyclesRemaining : 1}`;
			let lockClass = '';
			
			if (!isOpponent && p.cyclePenalty > 0) {
				cycleText = '🚫';
				lockClass = 'is-debuffed';
			}

			const cycleBtnHTML = isOpponent ? '' : `
				<button class="card-cycle-btn ${lockClass}" onclick="game.cycleCard(${playerNum}, ${index}, event)">
					<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
					</svg>
					<span class="card-cycle-text">${cycleText}</span>
				</button>`;

			const dataAttrs = isOpponent ? `data-theme="${realTheme}" data-icons="${safeIcons}" data-text="${realText}" data-layout="${layoutClass}"` : '';

			const cardHTML = `
				<div class="activity-card ${animClass} ${rarityClass}" id="${idPrefix}${index}" style="${animStyle}" ${dataAttrs}>
					${cycleBtnHTML}
					${tooltipHTML}
					<div class="card-body ${themeClass}">
						<div class="card-inner">
							<div class="card-icons ${layoutClass}">
								${cardIconsHTML}
							</div>
							${typeText ? `<div class="activity-type">${typeText}</div>` : ''}
						</div>
					</div>
				</div>
			`;
			
			container.insertAdjacentHTML('beforeend', cardHTML);
			
			// --- SWIPE LOGIC (PLAYER ONLY) ---
			if (!isOpponent) {
				const cardEl = document.getElementById(`${idPrefix}${index}`);
				let startY = 0, currentY = 0, isDragging = false;

				cardEl.addEventListener('pointerdown', (e) => {
					if (e.button !== 0 || e.target.closest('.card-cycle-btn')) return;
					
					isDragging = true; 
					startY = e.clientY; 
					cardEl.classList.add('is-dragging', 'touch-active'); 
					cardEl.setPointerCapture(e.pointerId); 
				});

				cardEl.addEventListener('pointermove', (e) => {
					if (!isDragging) return;
					currentY = e.clientY - startY;
					
					if (currentY > 0) {
						currentY = currentY * 0.2; 
						cardEl.style.translate = `0 ${currentY}px`; 
						cardEl.style.scale = `1.05`;
					} 
					else {
						cardEl.style.translate = `0 ${currentY}px`; 
						cardEl.style.scale = `1.05`;
						
						const dragProgress = Math.min(1, -currentY / 60);
						
						const tooltip = cardEl.querySelector('.card-tooltip');
						if (tooltip) {
							tooltip.style.opacity = (1 - (dragProgress * 1.5)).toString();
							tooltip.style.visibility = dragProgress > 0.6 ? 'hidden' : 'visible';
						}
						
						const cycleBtn = cardEl.querySelector('.card-cycle-btn');
						if (cycleBtn) {
							const btnScale = 1 + (dragProgress * 0.6);
							cycleBtn.style.transform = `scale(${btnScale})`;
							
							if (dragProgress >= 1) {
								cycleBtn.style.background = 'var(--accent-red)';
								cycleBtn.style.boxShadow = '0 0 20px rgba(255, 75, 75, 0.6)';
								cycleBtn.style.color = '#fff';
							} else {
								cycleBtn.style.background = '';
								cycleBtn.style.boxShadow = '';
								cycleBtn.style.color = '';
							}
						}
					}
				});

				const endDrag = (e) => {
					if (!isDragging) return;
					isDragging = false; 
					cardEl.classList.remove('is-dragging', 'touch-active'); 
					cardEl.releasePointerCapture(e.pointerId);
					
					const tooltip = cardEl.querySelector('.card-tooltip');
					if (tooltip) {
						tooltip.style.opacity = '';
						tooltip.style.visibility = '';
					}
					const cycleBtn = cardEl.querySelector('.card-cycle-btn');
					if (cycleBtn) {
						cycleBtn.style.transform = '';
						cycleBtn.style.background = '';
						cycleBtn.style.boxShadow = '';
						cycleBtn.style.color = '';
					}

					if (currentY < -60) {
						cardEl.style.translate = ''; cardEl.style.scale = ''; 
						this.cycleCard(playerNum, index, null, true);
					} else {
						cardEl.style.translate = ''; cardEl.style.scale = '';
					}
					currentY = 0; 
				};

				cardEl.addEventListener('pointerup', endDrag);
				cardEl.addEventListener('pointercancel', endDrag);
			}

			// Sound Integration
			if (animateMode === 'full') {
				setTimeout(() => sound.play('card_flick', spatialPan), index * 50); 
			} else if (animateMode === 'draw-last' && index === p.hand.length - 1) {
				sound.play('card_flick', spatialPan);
			}
		});
	},
	
	activateCardEffect: function(playerNum, cardKey, stackIndex = 0, totalStackCount = 1, suppressLog = false) {
		const data = this.RESOURCE_CARDS[cardKey];
		if (!data) return;

		let container = document.getElementById('hold-effect-layer');
		if (!container) {
			container = document.createElement('div');
			container.id = 'hold-effect-layer';
			container.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999; overflow: hidden;';
			const gameUI = document.getElementById('game-ui') || document.body;
			gameUI.appendChild(container);
		}

		let themeClass = data.theme || 'theme-build';
		let layoutClass = data.layout || 'icon-layout-1';
		let typeText = data.shortName || cardKey.replace('_', ' ').toUpperCase();
		let cardIconsHTML = data.svg || '';

		// --- THE FIX 1: Extract descText early so we can evaluate its type ---
		let descText = data.desc || data.description || data.effect || data.text || "";
		const isHoldEffect = descText.toLowerCase().includes('hold');

		if (stackIndex === 0 && !suppressLog && typeof this.log === 'function') {
			if (/(hold|discard)/i.test(descText)) {
				descText = `<strong style="background: rgba(0, 0, 0, 0.75); color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.9em; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); margin-left: 4px;">${descText}</strong>`;
			}
			
			const pLabel = playerNum === 1 ? 'P1' : 'P2';
			const cardName = data.name || typeText;
			
			let multiplierBadge = "";
			if (totalStackCount > 1) {
				multiplierBadge = `<span style="background: var(--gold); color: #000; padding: 1px 6px; border-radius: 6px; font-weight: 900; font-size: 0.85em; margin-left: 4px; box-shadow: 0 0 5px rgba(255,215,0,0.5);">x${totalStackCount}</span>`;
			}
			
			this.log(`<span style="color:#aaa; font-size:0.9em;">${pLabel} activates <em>${cardName}</em>${multiplierBadge} ${descText}</span>`);
		}

		let glowColor = 'rgba(255, 255, 255, 0.6)';
		if (data.rarity === 'rare') glowColor = 'rgba(52, 152, 219, 0.7)';
		if (data.rarity === 'epic') glowColor = 'rgba(155, 89, 182, 0.8)';
		if (data.rarity === 'legendary') glowColor = 'rgba(241, 196, 15, 0.9)';

		const isRightSide = (playerNum === 2);
		const startX = isRightSide ? '50vw' : '-50vw'; 
		const endX = isRightSide ? '-220px' : '220px';
		const rot = isRightSide ? '-8deg' : '8deg';
		
		const yOffset = stackIndex * 35;
		const animDelaySec = (stackIndex * 0.15).toFixed(2); 

		const cardEl = document.createElement('div');
		
		// --- THE FIX 2: Bind ownership and effect-type classes to the DOM element ---
		cardEl.className = `activity-card card-hold-reveal player-${playerNum}-effect ${isHoldEffect ? 'is-hold-card' : 'is-discard-card'}`;
		
		const isProjectile = ['tsuppari', 'soppugata'].includes(cardKey);
		if (isProjectile) {
			cardEl.id = `${cardKey}-p${playerNum}-${stackIndex}`;
		}
		
		cardEl.style.cssText = `
			position: absolute;
			top: calc(30% + ${yOffset}px);
			${isRightSide ? 'right: -30px;' : 'left: -30px;'}
			z-index: ${100 - stackIndex}; 
			--start-x: ${startX};
			--end-x: ${endX};
			--rot: ${rot};
			--glow-color: ${glowColor};
			animation-delay: ${animDelaySec}s;
		`;

		cardEl.innerHTML = `
			<div class="card-body ${themeClass}">
				<div class="card-inner">
					<div class="card-icons ${layoutClass}">
						${cardIconsHTML}
					</div>
					<div class="activity-type">${typeText}</div>
				</div>
			</div>
		`;
		
		container.appendChild(cardEl);

		setTimeout(() => {
			if (typeof sound !== 'undefined') sound.play('card_flick');
		}, stackIndex * 150); 

		setTimeout(() => {
			// Add a dying class just in case the query fires right as it removes
			cardEl.classList.add('is-exiting'); 
			if (cardEl && cardEl.parentNode) cardEl.remove();
		}, isProjectile ? 5000 : 3300 + (stackIndex * 150));
		
		if (playerNum === 1) {
			setTimeout(() => {
				const holdLayer = document.getElementById('hold-effect-layer');
				if (holdLayer) {
					// --- THE FIX 3: Strict, specific querying ---
					// Only count P1 cards, only count Holds, and ignore dying cards!
					const activeHoldCards = holdLayer.querySelectorAll('.player-1-effect.is-hold-card:not(.is-exiting)').length;
					
					if (activeHoldCards >= 3) {
						this.unlockAchievement('kongō_riki');
					}
				}
			}, 50);

			const currentHandTypes = this.p1.hand.map(c => c.type);
			if ((cardKey === 'a_gyo' && currentHandTypes.includes('un_gyo')) || 
				(cardKey === 'un_gyo' && currentHandTypes.includes('a_gyo'))) {
				this.unlockAchievement('nio_mon');
			}

			if (cardKey === 'kimedashi' && this.p1.hasIronWall) {
				this.unlockAchievement('fudo_no_kami');
			}
		}
	},
	
	renderDebuffs: function(playerNum) {
		const p = playerNum === 1 ? this.p1 : this.p2;
		let container = document.getElementById(`p${playerNum}-debuff-container`);
		
		if (!container) {
			container = document.createElement('div');
			container.id = `p${playerNum}-debuff-container`;
			container.style.cssText = 'position: absolute; z-index: 150; display: flex; gap: -15px; pointer-events: none;';
			
			if (playerNum === 1) {
				container.style.left = '30px';
				container.style.bottom = '260px'; 
			} else {
				container.style.right = '30px';
				container.style.bottom = '180px'; 
				container.style.flexDirection = 'row-reverse';
			}
			
			const gameUI = document.getElementById('game-ui') || document.body;
			gameUI.appendChild(container);
		}
		
		let badgesToRender = [];
		
		// 1. Add Active Nekodamashi (Solid)
		for(let i=0; i < (p.cyclePenalty || 0); i++) {
			badgesToRender.push({ type: 'nekodamashi', isPending: false });
		}
		// 2. Add Pending Nekodamashi (Pulsing)
		for(let i=0; i < (p.pendingCyclePenalty || 0); i++) {
			badgesToRender.push({ type: 'nekodamashi', isPending: true });
		}
		// 3. Add Pending Shikiri-naoshi (Pulsing)
		for(let i=0; i < (p.pendingShikiriPenalty || 0); i++) {
			badgesToRender.push({ type: 'shikiri_naoshi', isPending: true });
		}
		
		// --- THE FIX: POOL-BASED RECONCILIATION ---
		// Grab all icons that aren't already dying and put them in a draft pool
		const validIcons = Array.from(container.children).filter(el => !el.classList.contains('debuff-exit'));
		const availablePool = [...validIcons]; 
		const finalDomOrder = [];

		for (let i = 0; i < badgesToRender.length; i++) {
			const badgeData = badgesToRender[i];
			const cardData = this.RESOURCE_CARDS[badgeData.type];
			
			// Find an exact match in our pool
			const matchIndex = availablePool.findIndex(icon => icon.dataset.type === badgeData.type);
			
			let icon;
			let isNew = false;

			if (matchIndex !== -1) {
				// Match found! Pull it out of the available pool so it isn't reused
				icon = availablePool.splice(matchIndex, 1)[0];
			} else {
				// No match exists, birth a new badge
				icon = document.createElement('div');
				icon.className = 'debuff-badge debuff-enter';
				icon.style.animationDelay = `${(i - validIcons.length) * 0.15}s`;
				icon.dataset.type = badgeData.type; 
				icon.innerHTML = cardData.svg;
				isNew = true;
			}
			
			// Handle the pulse state
			if (badgeData.isPending) {
				if (isNew) {
					setTimeout(() => {
						if (icon.parentNode && !icon.classList.contains('debuff-exit')) {
							icon.classList.add('debuff-pending');
						}
					}, 400); 
				} else {
					icon.classList.add('debuff-pending');
				}
			} else {
				icon.classList.remove('debuff-pending');
			}

			finalDomOrder.push(icon);
		}
		
		// Anything left in the availablePool wasn't needed. Fade them out!
		availablePool.forEach((icon, idx) => {
			icon.classList.remove('debuff-enter', 'debuff-pending');
			icon.classList.add('debuff-exit');
			icon.style.animationDelay = `${idx * 0.08}s`;
			setTimeout(() => { if (icon.parentNode) icon.remove(); }, 300);
		});

		// Finally, re-append the surviving icons in the exact order they should appear.
		// Flexbox will automatically snap them into the right overlapping sequence.
		finalDomOrder.forEach(icon => container.appendChild(icon));
	},
	
	// =========================================
	// DECK BUILDER SYSTEM
	// =========================================

	MIN_DECK_SIZE: 12,
	MAX_DECK_SIZE: 64,
	deckFilter: 'all', // Current active tab

	openDeckBuilder: function(returnContext = 'stable') {
		// --- 1. ESTABLISH STATE MEMORY ---
		// Defaults to 'stable' if opened normally, but will catch 'loot' if passed from the loot screen.
		this.deckReturnContext = returnContext; 

		if (!this.career) this.career = {};
		
		// Use the exact same robust check
		if (!this.career.cardCollection || Object.keys(this.career.cardCollection).length === 0) {
			this.career.cardCollection = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
		}

		if (!this.career.activeDeck || this.career.activeDeck.length === 0) {
			this.career.activeDeck = [];
			const defaultCounts = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
			Object.keys(defaultCounts).forEach(type => {
				for (let i = 0; i < defaultCounts[type]; i++) this.career.activeDeck.push(type);
			});
			if (typeof this.saveCareer === 'function') this.saveCareer();
		}

		this.tempWorkingDeck = [...this.career.activeDeck];
		this.deckFilter = 'all';

		this.renderDeckBuilder();
		document.getElementById('deck-builder-screen').classList.remove('hidden');
		if (typeof sound !== 'undefined') sound.play('click');
	},

	closeDeckBuilder: function() {
		document.getElementById('deck-builder-screen').classList.add('hidden');
		this.tempWorkingDeck = null;
		if (typeof sound !== 'undefined') sound.play('click');

		// --- CLEAR UNSEEN STATUSES UPON CLOSING ---
		if (this.unseenItemIds && this.newUnlocksByCategory && this.newUnlocksByCategory.deck) {
			
			// Remove any Resource Card keys from the unseen set
			Object.keys(this.RESOURCE_CARDS || {}).forEach(cardKey => {
				this.unseenItemIds.delete(cardKey);
			});
			
			// Turn off the deck notification flag
			this.newUnlocksByCategory.deck = false;
			
			// Update the home screen and tabs to remove the dots
			if (typeof this.updateStableNotification === 'function') this.updateStableNotification();
			if (typeof this.updateTabIndicators === 'function') this.updateTabIndicators();
		}

		// --- 2. THE CONTEXT ROUTER ---
		if (this.deckReturnContext === 'loot') {
			const lootContainer = document.getElementById('loot-container');
			if (lootContainer) {
				// Restore visibility and bring it to the front
				lootContainer.style.opacity = '1';
				lootContainer.style.visibility = 'visible';
				lootContainer.style.zIndex = '5000';
				
				// Brief pause so the player sees their cards one last time
				setTimeout(() => {
					lootContainer.classList.add('slide-out');
				}, 1000);
			}
			this.deckReturnContext = 'stable'; 
		}
	},

	setDeckFilter: function(filterType) {
		this.deckFilter = filterType;
		if (typeof sound !== 'undefined') sound.play('click');
		this.renderDeckBuilder();
	},

	saveAndCloseDeck: function() {
		if (this.tempWorkingDeck.length < this.MIN_DECK_SIZE || this.tempWorkingDeck.length > this.MAX_DECK_SIZE) {
			const counterBadge = document.getElementById('deck-counter-badge');
			if (counterBadge) {
				counterBadge.classList.add('shake-active');
				setTimeout(() => counterBadge.classList.remove('shake-active'), 300);
			}
			if (typeof sound !== 'undefined') sound.play('qte_fail');
			return;
		}
		
		this.career.activeDeck = [...this.tempWorkingDeck];
		this.saveCareer(); 
		this.closeDeckBuilder();
	},

	adjustDeckCard: function(cardKey, change) {
		const currentAmt = this.tempWorkingDeck.filter(c => c === cardKey).length;
		const maxOwned = this.career.cardCollection[cardKey] || 0;
		const currentTotal = this.tempWorkingDeck.length;

		if (change > 0) {
			if (currentTotal >= this.MAX_DECK_SIZE) {
				const counterBadge = document.getElementById('deck-counter-badge');
				if (counterBadge) {
					counterBadge.classList.add('shake-active');
					setTimeout(() => counterBadge.classList.remove('shake-active'), 300);
				}
				if (typeof sound !== 'undefined') sound.play('qte_fail');
				return;
			}
			if (currentAmt >= maxOwned) {
				if (typeof sound !== 'undefined') sound.play('qte_fail');
				return; 
			}
			
			this.tempWorkingDeck.push(cardKey);
			this.tempWorkingDeck.sort(); // Keeps the spectrum bar visually organized!
			if (typeof sound !== 'undefined') sound.play('card_flick');
			
		} else {
			if (currentAmt <= 0) return; 
			const indexToRemove = this.tempWorkingDeck.indexOf(cardKey);
			if (indexToRemove > -1) {
				this.tempWorkingDeck.splice(indexToRemove, 1);
			}
			if (typeof sound !== 'undefined') sound.play('card_flick');
		}

		this.renderDeckBuilder(); 
	},

	renderDeckBuilder: function() {
		const visualizer = document.getElementById('deck-visualizer');
		const draftPool = document.getElementById('deck-draft-pool');
		const countSpan = document.getElementById('deck-builder-count');
		const maxSpan = document.getElementById('deck-builder-max');
		const saveBtn = document.getElementById('btn-save-deck');

		// Update Tabs
		document.querySelectorAll('.filter-tab').forEach(tab => {
			tab.classList.remove('active');
			if (tab.innerText.toLowerCase().includes(this.deckFilter) || (this.deckFilter === 'all' && tab.innerText === 'ALL')) {
				tab.classList.add('active');
			}
		});

		let currentTotal = 0;
		if (this.gomaMode) {
			Object.values(this.gomaSelection).forEach(val => currentTotal += val);
			maxSpan.innerText = "∞"; 
			countSpan.innerText = currentTotal;
			countSpan.style.color = currentTotal > 0 ? '#e74c3c' : '#ccc';
		} else {
			currentTotal = this.tempWorkingDeck.length;
			maxSpan.innerText = this.MAX_DECK_SIZE;
			countSpan.innerText = currentTotal;

			if (currentTotal < this.MIN_DECK_SIZE || currentTotal > this.MAX_DECK_SIZE) {
				countSpan.style.color = 'var(--accent-red)';
				saveBtn.style.opacity = '0.5';
			} else {
				countSpan.style.color = 'var(--gold)';
				saveBtn.style.opacity = '1';
			}
		}

		// 1. RENDER THE SPECTRUM BAR
		visualizer.innerHTML = '';
		const themeToColor = {
			'theme-build': '#27ae60', 
			'theme-h-atk': 'var(--accent-red)', 
			'theme-l-atk': 'var(--gold)',
			'theme-h-block': 'var(--p1-color)', 
			'theme-l-block': '#b3c2cd',
			'theme-waki': '#2980b9', 
			'theme-suri': '#9b59b6',  
			'theme-kime': '#f1c40f' 
		};

		const sourceArray = this.gomaMode ? Object.keys(this.gomaSelection).flatMap(k => Array(this.gomaSelection[k]).fill(k)) : this.tempWorkingDeck;
		
		sourceArray.forEach(cardKey => {
			const slice = document.createElement('div');
			slice.className = 'deck-slice';
			const cardData = this.RESOURCE_CARDS[cardKey] || {};
			slice.style.backgroundColor = themeToColor[cardData.theme] || '#ccc';
			visualizer.appendChild(slice);
		});

		let attackMoves = ['strike', 'sweep', 'thrust', 'throw']; 
		if (this.playerLoadout && this.playerLoadout.length >= 4) attackMoves = this.playerLoadout;
		let highAttacks = []; let lowAttacks = [];
		attackMoves.forEach(moveKey => {
			if (MOVES[moveKey]) {
				if (MOVES[moveKey].type.includes('high')) highAttacks.push(moveKey);
				else if (MOVES[moveKey].type.includes('low')) lowAttacks.push(moveKey);
			}
		});

		// 2. RENDER THE BINDER
		draftPool.innerHTML = '';
		const rarityWeights = { 'common': 1, 'rare': 2, 'epic': 3, 'legendary': 4 };
		
		const sortedKeys = Object.keys(this.RESOURCE_CARDS || {}).sort((a, b) => {
			const rarityA = (this.RESOURCE_CARDS[a].rarity || 'common').toLowerCase();
			const rarityB = (this.RESOURCE_CARDS[b].rarity || 'common').toLowerCase();
			return rarityWeights[rarityA] - rarityWeights[rarityB];
		});

		sortedKeys.forEach((cardKey, index) => {
			const totalOwned = this.career.cardCollection[cardKey] || 0;
			if (totalOwned <= 0) return; 

			const data = this.RESOURCE_CARDS[cardKey];
			const currentRarity = (data.rarity || 'common').toLowerCase();
			if (this.deckFilter !== 'all' && currentRarity !== this.deckFilter) return;

			// --- THE FIX: UNIFIED DRAFT STATE ---
			// We always check the unsaved 'tempWorkingDeck' so UI is always in sync.
			const equippedInDraft = this.tempWorkingDeck.filter(c => c === cardKey).length;
			
			let displayedAmt = 0;
			let maxAvailable = 0;
			let disableAdd = false;
			let disableMinus = false;
			let clickHandlerStr = "";
			let isDimmed = false;

			if (this.gomaMode) {
				maxAvailable = totalOwned - equippedInDraft; // You can't burn what is currently drafted!
				displayedAmt = this.gomaSelection[cardKey] || 0;
				
				disableAdd = (displayedAmt >= maxAvailable);
				disableMinus = (displayedAmt <= 0);
				clickHandlerStr = `game.adjustGomaCard('${cardKey}', `;
				isDimmed = (maxAvailable <= 0); // Dim the card if all copies are safely in the drafted deck
			} else {
				maxAvailable = totalOwned;
				displayedAmt = equippedInDraft;
				
				disableAdd = (currentTotal >= this.MAX_DECK_SIZE) || (displayedAmt >= maxAvailable);
				disableMinus = (displayedAmt <= 0);
				clickHandlerStr = `game.adjustDeckCard('${cardKey}', `;
				isDimmed = (disableAdd && displayedAmt === 0);
			}
			
			let themeClass = data.theme || 'theme-build';
			let layoutClass = data.layout || 'icon-layout-1';
			let typeText = data.shortName || cardKey.replace('_', ' ').toUpperCase();
			let rarityClass = data.rarity ? `rarity-${data.rarity.toLowerCase()}` : 'rarity-common';
			let cardIconsHTML = '';

			if (data.isDynamicIcon) {
				const missingX = `<div class="card-icon-slot"><svg viewBox="0 0 24 24" stroke="var(--accent-red)" stroke-width="3" fill="none" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></div>`;
				if (cardKey === 'h_attack') { 
					if (highAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { layoutClass = `icon-layout-${Math.min(highAttacks.length, 4)}`; highAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
				} else if (cardKey === 'l_attack') { 
					if (lowAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { layoutClass = `icon-layout-${Math.min(lowAttacks.length, 4)}`; lowAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
				} else if (cardKey === 'w_attack') {
					// --- THE FIX: ADDED TO DECK BUILDER ---
					// Combines both arrays and draws up to 4 icons for the wildcard
					const allAttacks = [...highAttacks, ...lowAttacks];
					if (allAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
					else { 
						layoutClass = `icon-layout-${Math.min(allAttacks.length, 4)}`; 
						allAttacks.slice(0, 4).forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); 
					}
				}
			} else if (data.svg) {
				cardIconsHTML = data.svg;
			} else if (data.iconKey) {
				cardIconsHTML = `<div class="card-icon-slot">${MOVE_ICONS[data.iconKey] || '?'}</div>`;
			}

			const wrapper = document.createElement('div');
			wrapper.className = `deck-card-wrapper ${rarityClass} ${isDimmed ? 'disabled' : ''}`;
			wrapper.style.position = 'relative'; 
			
			const bobDelay = (index * -0.3).toFixed(2);
			
			let newBadgeHTML = '';
			if (this.unseenItemIds && this.unseenItemIds.has(cardKey)) {
				newBadgeHTML = `
					<div style="position: absolute; top: -5px; right: -15px; background: linear-gradient(135deg, #ffd700, #ffaa00); color: #5c3a00; font-weight: 900; font-size: 0.6rem; padding: 2px 6px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); z-index: 10; border: 1px solid #ffea80; pointer-events: none;">
						NEW
					</div>
				`;
			}
			
			// The HTML is now completely clean of ternary logic.
			wrapper.innerHTML = `
				${newBadgeHTML} 
				<div class="activity-card" style="animation-delay: ${bobDelay}s;">
					<div class="card-body ${themeClass}">
						<div class="card-inner">
							<div class="card-icons ${layoutClass}">
								${cardIconsHTML}
							</div>
							<div class="activity-type">${typeText}</div>
						</div>
					</div>
				</div>
				<div class="activity-desc">${data.desc || 'A powerful combat maneuver.'}</div>
				<div class="draft-controls">
					<button class="draft-btn minus" ${disableMinus ? 'disabled' : ''} onclick="${clickHandlerStr}-1)">−</button>
					<span>${displayedAmt} / ${maxAvailable}</span>
					<button class="draft-btn plus" ${disableAdd ? 'disabled' : ''} onclick="${clickHandlerStr}1)">+</button>
				</div>
			`;
			
			draftPool.appendChild(wrapper);
		});
	},
	
	// =========================================
	// SAITO GOMA (FIRE CEREMONY) SYSTEM
	// =========================================
	gomaMode: false,
	gomaSelection: {},

	toggleGomaMode: function() {
		this.gomaMode = !this.gomaMode;
		this.gomaSelection = {}; // Reset selections when toggling
		
		const screen = document.getElementById('deck-builder-screen');
		const title = document.getElementById('deck-builder-title');
		const sub = document.getElementById('deck-builder-subtitle');
		const counterLabel = document.getElementById('deck-counter-label');
		
		if (this.gomaMode) {
			screen.classList.add('goma-active');
			title.innerText = "SAITO GOMA";
			sub.innerText = "PASS EXCESS RESOURCES THROUGH THE PURIFYING FIRE";
			counterLabel.innerText = "OFFERINGS: ";
			if (typeof sound !== 'undefined') sound.play('boom'); // Ominous drum
		} else {
			screen.classList.remove('goma-active');
			title.innerText = "DECK BUILDER";
			sub.innerText = "MEDITATE ON YOUR STRATEGY";
			counterLabel.innerText = "DECK: ";
			if (typeof sound !== 'undefined') sound.play('click');
		}
		
		this.renderDeckBuilder();
	},

	adjustGomaCard: function(cardKey, change) {
		const currentAmt = this.gomaSelection[cardKey] || 0;
		
		// CHANGE: Reference tempWorkingDeck instead of career.activeDeck
		const equippedAmt = this.tempWorkingDeck.filter(c => c === cardKey).length;
		const maxOwned = (this.career.cardCollection[cardKey] || 0) - equippedAmt;

		if (change > 0) {
			if (currentAmt >= maxOwned) {
				if (typeof sound !== 'undefined') sound.play('qte_fail');
				return; 
			}
			this.gomaSelection[cardKey] = currentAmt + 1;
			if (typeof sound !== 'undefined') sound.play('card_flick');
		} else {
			if (currentAmt <= 0) return; 
			this.gomaSelection[cardKey] = currentAmt - 1;
			if (this.gomaSelection[cardKey] <= 0) delete this.gomaSelection[cardKey];
			if (typeof sound !== 'undefined') sound.play('card_flick');
		}

		this.renderDeckBuilder(); 
	},

	executeSaitoGoma: function() {
		const keys = Object.keys(this.gomaSelection);
		if (keys.length === 0) {
			if (typeof sound !== 'undefined') sound.play('qte_fail');
			return;
		}

		// 1. Play Ceremony Animation
		const screen = document.getElementById('deck-builder-screen');
		const sub = document.getElementById('deck-builder-subtitle');
		
		screen.classList.add('ceremony-flash');
		document.body.classList.add('shake-active'); 
		if (typeof sound !== 'undefined') {
			sound.play('boom');
			setTimeout(() => sound.play('powerup'), 400);
		}

		// Lock the button
		document.getElementById('btn-execute-goma').disabled = true;

		setTimeout(() => {
			screen.classList.remove('ceremony-flash');
			document.body.classList.remove('shake-active');
			document.getElementById('btn-execute-goma').disabled = false;

			const pools = { common: [], rare: [], epic: [], legendary: [] };
			for (let key in this.RESOURCE_CARDS) {
				let r = this.RESOURCE_CARDS[key].rarity || 'common';
				if (pools[r]) pools[r].push(key);
			}

			let newLoot = [];			

			// 2. Process Sacrifices
			keys.forEach(cardKey => {
				const count = this.gomaSelection[cardKey];
				const rarity = this.RESOURCE_CARDS[cardKey].rarity || 'common';

				this.career.cardCollection[cardKey] -= count;
				if (this.career.cardCollection[cardKey] <= 0) delete this.career.cardCollection[cardKey];

				for (let i = 0; i < count; i++) {
					let roll = Math.random();
					
					// ADJUSTED PROBABILITIES: Slightly more generous (20% for common upgrade)
					if (rarity === 'common') {
						if (roll < 0.20 && pools.rare.length) newLoot.push(pools.rare[Math.floor(Math.random() * pools.rare.length)]);
					} 
					else if (rarity === 'rare') {
						if (roll < 0.12 && pools.epic.length) newLoot.push(pools.epic[Math.floor(Math.random() * pools.epic.length)]);
						else if (roll < 0.30 && pools.common.length) {
							newLoot.push(pools.common[Math.floor(Math.random() * pools.common.length)]);
							newLoot.push(pools.common[Math.floor(Math.random() * pools.common.length)]);
						}
					} 
					else if (rarity === 'epic') {
						if (roll < 0.07 && pools.legendary.length) newLoot.push(pools.legendary[Math.floor(Math.random() * pools.legendary.length)]);
						else if (roll < 0.30 && pools.rare.length) {
							newLoot.push(pools.rare[Math.floor(Math.random() * pools.rare.length)]);
							newLoot.push(pools.rare[Math.floor(Math.random() * pools.rare.length)]);
						}
						else if (roll < 0.60 && pools.common.length) {
							for(let j=0; j<3; j++) newLoot.push(pools.common[Math.floor(Math.random() * pools.common.length)]);
						}
					} 
					else if (rarity === 'legendary') {
						if (roll < 0.15 && pools.legendary.length) newLoot.push(pools.legendary[Math.floor(Math.random() * pools.legendary.length)]);
						else if (roll < 0.50 && pools.epic.length) {
							newLoot.push(pools.epic[Math.floor(Math.random() * pools.epic.length)]);
							newLoot.push(pools.epic[Math.floor(Math.random() * pools.epic.length)]);
						}
						else if (roll < 0.90 && pools.rare.length) {
							for(let j=0; j<3; j++) newLoot.push(pools.rare[Math.floor(Math.random() * pools.rare.length)]);
						}
					}
				}
			});
			
			// Calculate the actual number of cards sacrificed this session
			const totalSacrificedThisTime = Object.values(this.gomaSelection).reduce((sum, count) => sum + count, 0);
			
			this.stats.totalCardsRecycled = (this.stats.totalCardsRecycled || 0) + totalSacrificedThisTime;
			if (this.stats.totalCardsRecycled >= 50) this.unlockAchievement('hanshin');

			// 3. Add loot to collection
			newLoot.forEach(cardKey => {
				this.career.cardCollection[cardKey] = (this.career.cardCollection[cardKey] || 0) + 1;
			});
			
			keys.forEach(cardKey => {
				const newTotal = this.career.cardCollection[cardKey] || 0;
				// Ensure the temp deck doesn't exceed the new, smaller collection count
				while (this.tempWorkingDeck.filter(c => c === cardKey).length > newTotal) {
					const idx = this.tempWorkingDeck.indexOf(cardKey);
					if (idx > -1) this.tempWorkingDeck.splice(idx, 1);
				}
			});

			this.saveCareer();
			this.gomaSelection = {}; 
			
			// --- THE FIX: Refresh the Binder instead of closing it! ---
			this.toggleGomaMode(); // Switch back to Deck Builder view
            this.renderDeckBuilder(); // Redraw the binder so cards are gone/added
            
            if (newLoot.length > 0) {
                // Show the flashy loot screen over the deck builder
                this.renderLootUI(newLoot, "GOMA BLESSING 護摩の恵み");
            } else {
                // THE ASH FANFARE: Swoop in the bad news!
                this.renderLootUI([], "CONSUMED BY FLAME 灰");
            }

        }, 1500); 
	},

	resolveTurn: function() {
		this.turnPhase = 3; 
		document.getElementById('controls').innerHTML = '';
		
		this.matchStats.rounds++;
		gyoji.stopIdleTimer();

		// --- THE BULLETPROOF FIX: Cache and Clear ---
		// We lock in the moves for the animation sequence, then IMMEDIATELY free 
		// the global state. This prevents a "Slow" client from accidentally deleting
		// a "Fast" client's queued move for the NEXT round at the end of their animation.
		const p1Move = this.p1.move;
		const p2Move = this.p2.move;
		
		this.matchStats.finalP1Move = p1Move; // Must Cache These so Achievements can track them!
		this.matchStats.finalP2Move = p2Move;
		
		this.p1.move = null;
		this.p2.move = null;

		this.waitForIdleAnimations(() => {
			const m1 = MOVES[p1Move];
			const m2 = MOVES[p2Move];

			const isHost = (this.mode !== 'online' || net.side === 'host');
			const me = isHost ? this.p1 : this.p2;
			const myMove = isHost ? m1 : m2;
			const opMove = isHost ? m2 : m1;
			
			// --- TRACKING ---      
			if (this.matchStats.rounds === 1) {
				if (myMove.name === 'Build Momentum') this.unlockAchievement('matta');
				if (myMove.name === 'throw') this.unlockAchievement('kachi_age');
			}
		
			if (myMove.type.includes('high')) this.matchStats.used_high = true;
			if (myMove.type.includes('low')) this.matchStats.used_low = true;

			if (myMove.type.includes('atk')) {
				 if (this.matchStats.lastMove === (isHost ? p1Move : p2Move)) {
					 this.matchStats.moveStreak++;
				 } else {
					 this.matchStats.moveStreak = 1;
					 this.matchStats.lastMove = (isHost ? p1Move : p2Move);
				 }
				 if (this.matchStats.moveStreak >= 3) this.unlockAchievement('deashi');
			} else {
				this.matchStats.moveStreak = 0;
				this.matchStats.lastMove = null;
			}

			const meType = myMove.type.split('_')[0]; 
			const opType = opMove.type.split('_')[0]; 
			
			if (meType === 'util') this.sessionStats.t_b++;
			else if (meType === 'def') this.sessionStats.t_d++;
			else if (meType === 'atk') this.sessionStats.t_a++;
			
			if (meType === 'util') {
				if (opType !== 'atk') this.sessionStats.s_b++;
			} else if (meType === 'def') {
				if (opType === 'atk') this.sessionStats.s_d++;
			} else if (meType === 'atk') {
				if (opType === 'util') this.sessionStats.s_a++;
				else if (opType === 'atk') {
					if (myMove.dmg > opMove.dmg) this.sessionStats.s_a++;
				}
			}

			// Display logic
			const b1 = document.getElementById('p1-badge');
			const b2 = document.getElementById('p2-badge');

			b1.innerText = m1.name;
			b2.innerText = m2.name;

			b1.className = `move-badge p1 move-${p1Move}`;
			b2.className = `move-badge p2 move-${p2Move}`;
			
			if (m1.type.includes('low')) {
				b1.style.color = 'var(--gold)';
			} else if (m1.type.includes('high')) {
				b1.style.color = 'white';
			} else b1.style.color = 'white';

			if (m2.type.includes('low')) {
				b2.style.color = 'var(--gold)';
			} else if (m2.type.includes('high')) {
				b2.style.color = 'white';
			} else b2.style.color = 'white';

			b1.classList.add('show');
			
			const p1MoveIndex = this.getPlayerActionIndex(p1Move, true);
			const p2MoveIndex = this.getPlayerActionIndex(p2Move, false);

			this.p1.lastActionIndex5 = this.p1.lastActionIndex4;
			this.p1.lastActionIndex4 = this.p1.lastActionIndex3;
			this.p1.lastActionIndex3 = this.p1.lastActionIndex2;
			this.p1.lastActionIndex2 = this.p1.lastActionIndex;
			this.p1.lastActionIndex = p1MoveIndex;

			if (m1.type.includes('atk')) {
				this.p1.totalAtks++;
				if (m1.type.includes('high')) this.p1.highUsed++;
				if (m1.type.includes('low')) this.p1.lowUsed++;
			}

			this.p2.lastActionIndex5 = this.p2.lastActionIndex4;
			this.p2.lastActionIndex4 = this.p2.lastActionIndex3;
			this.p2.lastActionIndex3 = this.p2.lastActionIndex2;
			this.p2.lastActionIndex2 = this.p2.lastActionIndex;
			this.p2.lastActionIndex = p2MoveIndex;

			if (m2.type.includes('atk')) {
				this.p2.totalAtks++;
				if (m2.type.includes('high')) this.p2.highUsed++;
				if (m2.type.includes('low')) this.p2.lowUsed++;
			}    
			
			setTimeout(() => {
				document.getElementById('vs-icon').classList.add('show');
				setTimeout(() => {
					b2.classList.add('show');
					// We pass the cached string keys into animateCombat!
					this.animateCombat(m1, m2, p1Move, p2Move); 
				}, 400 * this.timeMult);
			}, 400 * this.timeMult);
		});     
	},
	
	//Helper for Overpowering Attack Animation
	shatterBadge: function(playerNum) {
        // Find the active badge for the overpowered player
        const badge = document.querySelector(`.move-badge.p${playerNum}.show`);
        if (!badge || badge.classList.contains('shattered')) return;

        const text = badge.innerText;
        badge.innerHTML = ''; // Clear the regular text
        badge.classList.add('shattered');

        // Create the top jagged half
        const topHalf = document.createElement('div');
        topHalf.className = 'shatter-half top-half';
        topHalf.innerText = text;

        // Create the bottom jagged half
        const bottomHalf = document.createElement('div');
        bottomHalf.className = 'shatter-half bottom-half';
        bottomHalf.innerText = text;

        badge.appendChild(topHalf);
        badge.appendChild(bottomHalf);
    },
	
	waitForIdleAnimations: function(callback) {
		const checkIdle = () => {
			// Look for any element currently playing an idle animation
			if (document.querySelector('.idle-override')) {
				// If found, wait 100ms and check again
				setTimeout(checkIdle, 100);
			} else {
				// If clear, execute the combat logic
				callback();
			}
		};
		checkIdle();
	},
	
	spawnMomentumIcon: function(pNum) {
        const rikishi = document.getElementById(`p${pNum}-rikishi`);
        if (!rikishi) return;

        // --- 1. EXISTING AVATAR PARTICLE LOGIC ---
        const particle = document.createElement('div');
        particle.className = `momentum-particle p${pNum}-particle`;
        
        particle.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">
                <path d="M7 16l5-5 5 5"/><path d="M7 10l5-5 5 5"/>
            </svg>
        `;

        rikishi.appendChild(particle);
        setTimeout(() => particle.remove(), 1200);

        // --- 2. NEW PIP FILLING ANIMATION ---
        const track = document.getElementById(`p${pNum}-mom-track`);
        if (track) {
            // Find the first empty pip
            const emptyPips = Array.from(track.querySelectorAll('.mom-pip:not(.filled)'));
            
            if (emptyPips.length > 0) {
                const pipToFill = emptyPips[0];
                
                // Mark as filled so the game knows it's taken, but NO color yet!
                pipToFill.classList.add('filled'); 
                
                // Create the expanding color ghost div
                const fx = document.createElement('div');
                fx.className = `pip-gain-fx p${pNum}`; // This now grabs your var(--p1-color)!
                
                // Obey global game speed
                const animDuration = 0.4 * (this.timeMult || 1);
                fx.style.animationDuration = `${animDuration}s`;
                
                pipToFill.appendChild(fx);

                // --- LOCK IN THE NATIVE CSS ---
                // When the animation is over, apply the true class to the container and delete the ghost
                setTimeout(() => {
                    pipToFill.classList.add(`p${pNum}`);
                    if (fx.parentNode) fx.remove();
                }, animDuration * 1000); // Multiply by 1000 to convert seconds to ms
            }
        }
    },
	
	spawnMomentumLossIcon: function(pNum) {
        const rikishi = document.getElementById(`p${pNum}-rikishi`);
        if (!rikishi) return;

        const particle = document.createElement('div');
        particle.className = `momentum-loss-particle p${pNum}-loss-particle`;
        
        // Downward facing double chevron
        particle.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">
                <path d="M7 8l5 5 5-5"/><path d="M7 14l5 5 5-5"/>
            </svg>
        `;

        rikishi.appendChild(particle);

        setTimeout(() => particle.remove(), 1200);
    },
	
	spawnDust: function(pNum, moveType) {
        if (typeof vfx === 'undefined') return;

        // 1. Get exact position of the Rikishi's feet relative to the VFX canvas
        const rikishiEl = document.getElementById(`p${pNum}-rikishi`);
        const vfxCanvas = vfx.canvas;
        if (!rikishiEl || !vfxCanvas) return;

        const rect = rikishiEl.getBoundingClientRect();
        const vfxRect = vfxCanvas.getBoundingClientRect();

        // Calculate the center-bottom of the avatar
        const baseX = (rect.left + rect.width / 2) - vfxRect.left;
        
        // Bump it up slightly so the dirt spawns around their heels, not below the floor
        const baseY = (rect.bottom - vfxRect.top) - 10; 

        // 2. Configure the burst
        const particleCount = 45; // High particle count for a dense cloud
        const isUtchari = moveType === 'utchari';

        for (let i = 0; i < particleCount; i++) {
            // Randomize spawn point in a tight cluster around the feet
            const x = baseX + (Math.random() * 50 - 25);
            const y = baseY + (Math.random() * 20 - 10);

            let vx = 0;
            let vy = 0;

            if (isUtchari) {
                // UTCHARI: Explosive upward burst
                // Wide horizontal spread, high vertical velocity shooting straight up
                vx = (Math.random() - 0.5) * 18; 
                vy = (Math.random() * -14) - 4; 
            } else { 
                // NODOWA: High-speed jet backward
                // Digging heels in means pushing forward, shooting dirt backward behind them
                const dir = pNum === 1 ? -1 : 1; 
                
                // Fast horizontal speed, very low vertical arc
                vx = (Math.random() * 18 + 6) * dir;
                vy = (Math.random() * -6) - 1; 
            }

            // Mix of tiny sand grains and larger chunky dirt clods
            const size = Math.random() * 8 + 2;

            // Pick randomly from the color palette you established in the CSS
            const colors = [
                {r: 0.95, g: 0.90, b: 0.78}, // #f4e7c9 (Bright Core Sand)
                {r: 0.86, g: 0.70, b: 0.36}, // #dcb35c (Mid Straw/Clay)
                {r: 0.79, g: 0.63, b: 0.45}  // #cba273 (Dark Dirt/Shadow)
            ];
            const c = colors[Math.floor(Math.random() * colors.length)];

            // Life in milliseconds (the engine naturally subtracts 16 per frame)
            const life = Math.random() * 600 + 300; 

            // Fast, chaotic tumbling
            const angle = Math.random() * Math.PI * 2;
            const angularVelocity = (Math.random() - 0.5) * 0.6;

            // Emit! We use type: 1.0 (Confetti mode) because square shapes tumbling rapidly 
            // look exactly like fragmented dirt clods breaking apart in the air.
            vfx.emit(x, y, vx, vy, size, c.r, c.g, c.b, 0.9, life, angle, angularVelocity, 1.0);
        }
    },

	animateCombat: function(m1, m2, p1MoveKey, p2MoveKey) {
		this.lastDamageSource = 'normal'; 
        const p1El = document.getElementById('p1-rikishi');
        const p2El = document.getElementById('p2-rikishi');
        const isHost = (this.mode !== 'online' || net.side === 'host');
		
		// --- REFINED: THE UNIVERSAL BARRAGE ORCHESTRATOR ---
		const executeProjectileBarrage = (launcherNum, baseDmg, totalProjectiles, moveKey, victimRecoveryWiggle, cardKey) => {
			const victimEl = launcherNum === 1 ? p2El : p1El;
			const victimNum = launcherNum === 1 ? 2 : 1;
			const targetX = launcherNum === 1 ? '60vw' : '-60vw';
			const victimHp = launcherNum === 1 ? this.p2.hp : this.p1.hp;
			
			setTimeout(() => {
				let cumulativeDmg = baseDmg;
				for(let i = 0; i < totalProjectiles; i++) {
					setTimeout(() => {
						cumulativeDmg += 1;
						
						const currentFinalHP = victimHp - cumulativeDmg;
						const currentTriggersBalance = currentFinalHP === 0 || (currentFinalHP < 0 && currentFinalHP >= -victimRecoveryWiggle);
						const currentTrueFatal = currentFinalHP < 0 && !currentTriggersBalance;
						
						const prevFinalHP = victimHp - (cumulativeDmg - 1);
						const prevTriggersBalance = prevFinalHP === 0 || (prevFinalHP < 0 && prevFinalHP >= -victimRecoveryWiggle);
						const prevTrueFatal = prevFinalHP < 0 && !prevTriggersBalance;
						
						const causedFatal = currentTrueFatal && !prevTrueFatal;
						const causedTeeter = currentTriggersBalance && !prevTriggersBalance;

						// 1. Launch the Card Projectile
						const cardEl = document.getElementById(`${cardKey}-p${launcherNum}-${i}`);
						if (cardEl) {
							const currentTransform = window.getComputedStyle(cardEl).transform;
							cardEl.style.animation = 'none'; 
							const pullBackX = launcherNum === 1 ? '180px' : '-180px';
							const pullBackRot = launcherNum === 1 ? '-15deg' : '15deg';
							const strikeRot = launcherNum === 1 ? '45deg' : '-45deg';

							cardEl.animate([
								{ transform: currentTransform, opacity: 1, offset: 0 },
								{ transform: `translate(${pullBackX}, -15px) rotate(${pullBackRot}) scale(1.15)`, opacity: 1, offset: 0.25 }, 
								{ transform: `translate(${targetX}, 20px) rotate(${strikeRot}) scale(0.3)`, opacity: 0, offset: 1 } 
							], { duration: 350, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)', fill: 'forwards' });
						}

						// 2. Resolve the Impact and State Transition
						setTimeout(() => {
							// Contextual Effects based on the projectile type!
							if (cardKey === 'soppugata') {
								if (typeof sound !== 'undefined') sound.play('thwack', launcherNum === 1 ? 0.6 : -0.6);
								if (typeof this.triggerRecoilZap === 'function') this.triggerRecoilZap(victimNum);
							} else {
								if (typeof sound !== 'undefined') sound.play('thwack');
								if (typeof this.triggerRecoilZap === 'function') this.triggerRecoilZap(victimNum);
							}
							
							if (typeof this.jitterHPBar === 'function') this.jitterHPBar(victimNum);

							victimEl.classList.remove('struck-strike', `struck-${moveKey}`, 'anim-teeter');
							void victimEl.offsetWidth; // Force Reflow

							if (currentTrueFatal) {
								victimEl.classList.add('hit-anim', `fatal-strike`);
							} 
							else if (currentTriggersBalance) {
								victimEl.classList.add('anim-teeter');
								if (causedTeeter) {
									if (typeof sound !== 'undefined') sound.play('teeter');
									const cardsNeeded = currentFinalHP < 0 ? Math.ceil(Math.abs(currentFinalHP) / 2) : 0;
									if (cardsNeeded > 0) {
										for(let s=0; s<cardsNeeded; s++) {
											game.activateCardEffect(victimNum, 'suri_ashi', s, cardsNeeded, true);
										}
									}
								}
							} 
							else {
								victimEl.classList.add('hit-anim', 'struck-strike');
							}
						}, 280); 
					}, i * 250); 
				}
			}, 350); 
		};
		// ----------------------------------------
		
		const triggerDynamicMuffle = (move) => {
			if (!this.music) return;
			const cost = move.cost || 0;
			
			if (cost >= 4) {
				this.music.applyImpactMuffle(1.0, 3200, true); 
			} 
			else if (cost === 3) {
				this.music.applyImpactMuffle(0.8, 3000, true); 
			} 
			else if (cost === 2) {
				this.music.applyImpactMuffle(0.8, 2500, false); 
			}
			else if (cost === 1) {
				this.music.applyImpactMuffle(0.6, 1500, false); 
			}
			else {
				this.music.applyImpactMuffle(0.4, 900, false);
			}
		};
        
        const p1Atk = m1.type.includes('atk');
        const p2Atk = m2.type.includes('atk');
		
		const p1Def = m1.type.includes('def');
		const p2Def = m2.type.includes('def');
        
        const p1BuildAnim = m1.name === "Build Momentum" ? (p2Atk ? 'anim-build-punished' : `anim-build-${Math.floor(Math.random() * 6) + 1}`) : null;
        const p2BuildAnim = m2.name === "Build Momentum" ? (p1Atk ? 'anim-build-punished' : `anim-build-${Math.floor(Math.random() * 6) + 1}`) : null;
		
		let p1DefWhiffAnim = null;
		let p2DefWhiffAnim = null;
		
		if (p1Def && !p2Atk) {
			const blockHeight = m1.type.split('_')[1]; 
			p1DefWhiffAnim = `anim-block-whiff-${blockHeight}-${Math.floor(Math.random() * 3) + 1}`;
		}
		if (p2Def && !p1Atk) {
			const blockHeight = m2.type.split('_')[1]; 
			p2DefWhiffAnim = `anim-block-whiff-${blockHeight}-${Math.floor(Math.random() * 3) + 1}`;
		}
		
		if (p1MoveKey === 'stall') this.spawnSweat(1);
		if (p2MoveKey === 'stall') this.spawnSweat(2);
		
		const getHoldCount = (pNum, type) => {
			const p = pNum === 1 ? this.p1 : this.p2;
			const isLocal = (this.mode !== 'online') || (typeof net !== 'undefined' && net.side === 'host' ? pNum === 1 : pNum === 2);
			
			if (isLocal) return p.hand ? p.hand.filter(c => c.type === type).length : 0;
			return p.networkHandTypes ? p.networkHandTypes.filter(t => t === type).length : 0;
		};
		
		const p1SuriCount = getHoldCount(1, 'suri_ashi');
		const p2SuriCount = getHoldCount(2, 'suri_ashi');
		
		const p1TsuppariCount = getHoldCount(1, 'tsuppari');
		const p2TsuppariCount = getHoldCount(2, 'tsuppari');
		
		const p1RecoveryWiggle = p1SuriCount;
		const p2RecoveryWiggle = p2SuriCount;

        if (p1BuildAnim) p1El.classList.add(p1BuildAnim);
        if (p2BuildAnim) p2El.classList.add(p2BuildAnim);
		
		if (p1DefWhiffAnim) p1El.classList.add(p1DefWhiffAnim);
		if (p2DefWhiffAnim) p2El.classList.add(p2DefWhiffAnim);

        let baseDelay = 1000; 
        const movesInPlay = [p1MoveKey, p2MoveKey];
        
        if (movesInPlay.includes('crush')) baseDelay = 600; 
        if (movesInPlay.includes('nodowa')) baseDelay = 1100; 
        if (movesInPlay.includes('utchari')) baseDelay = 900; 
        
        const hitDelay = baseDelay * this.timeMult;

        const localHP = isHost ? this.p1.hp : this.p2.hp;
        if (localHP === 1) {
            this.matchStats.roundsAtOneHP = (this.matchStats.roundsAtOneHP || 0) + 1;
        }

        if (isHost && m1.name === "Build Momentum") this.stats.total_build_actions++;
        if (!isHost && m2.name === "Build Momentum") this.stats.total_build_actions++;
        if (this.stats.total_build_actions >= 20) this.unlockAchievement('shiko');
        
        this.shatterMomentumPips(1, m1.cost);
        this.shatterMomentumPips(2, m2.cost);

        this.p1.mom = Math.max(0, this.p1.mom - m1.cost);
        this.p2.mom = Math.max(0, this.p2.mom - m2.cost);

        if (m1.type === 'util') {
            if (this.p1.mom != MAX_MOM) this.spawnMomentumIcon(1);
            sound.play('powerup');
            this.p1.mom = Math.min(MAX_MOM, this.p1.mom + 1);
            if (this.p1.mom === MAX_MOM) this.unlockAchievement('ankogata');
            if (m1.name === "Build Momentum") this.stats.total_build_actions = (this.stats.total_build_actions || 0) + 1;
        }
        if (m2.type === 'util') {
            if (this.p2.mom != MAX_MOM) this.spawnMomentumIcon(2);
            if (!(m1.type === 'util')) sound.play('powerup');
            this.p2.mom = Math.min(MAX_MOM, this.p2.mom + 1);
        }

		const m1Color = m1.type && m1.type.includes('low') ? 'var(--gold)' : 'white';
		const m2Color = m2.type && m2.type.includes('low') ? 'var(--gold)' : 'white';

		const styledM1 = `<span class="move-badge in-log move-${p1MoveKey}" style="color: ${m1Color};">${m1.name}</span>`;
		const styledM2 = `<span class="move-badge in-log move-${p2MoveKey}" style="color: ${m2Color};">${m2.name}</span>`;
		
        let d1 = 0; let d2 = 0; let log = "";
        let p1Perfect = false; let p2Perfect = false;

        if (p1Atk && p2Atk) {
            if (m1.dmg > m2.dmg) {
                d2 = m1.dmg;
                if (!this.matchStats.uniqueHits.includes(p1MoveKey)) this.matchStats.uniqueHits.push(p1MoveKey);
                
                log += `P1's ${styledM1} <span style="color:var(--accent-red)">OVERPOWERS</span> P2! `;
				
				if (p1TsuppariCount > 0) {
					d2 += p1TsuppariCount;
					log += `<br><span style="color:#9b59b6; font-weight:900;">TSUPPARI!</span> P1 deals +${p1TsuppariCount} Damage! `;
					for(let i=0; i<p1TsuppariCount; i++) {
						if (typeof game !== 'undefined') game.activateCardEffect(1, 'tsuppari', i, p1TsuppariCount);
						else this.activateCardEffect(1, 'tsuppari', i, p1TsuppariCount);
					}
				}
                
                p1El.classList.add('anim-' + p1MoveKey); 
                if (p1MoveKey === 'utchari') setTimeout(() => this.spawnDust(1, 'utchari'), 720 * this.timeMult);
                if (p1MoveKey === 'nodowa') setTimeout(() => this.spawnDust(1, 'nodowa'), 1000 * this.timeMult);
                
                setTimeout(() => {
                    if (p2BuildAnim) p2El.classList.remove(p2BuildAnim);
                    
                    this.shatterBadge(2);
					triggerDynamicMuffle(m1);
                    this.performImpactEffects(m1);
                    
					const baseP2FinalHP = this.p2.hp - m1.dmg;
					const baseP2TriggersBalance = baseP2FinalHP === 0 || (baseP2FinalHP < 0 && baseP2FinalHP >= -p2RecoveryWiggle);
					const baseP2CardsNeeded = baseP2FinalHP < 0 ? Math.ceil(Math.abs(baseP2FinalHP) / 2) : 0;
					const baseTrueFatal = baseP2FinalHP < 0 && !baseP2TriggersBalance;
					
					p2El.classList.add('hit-anim', baseTrueFatal ? `fatal-${p1MoveKey}` : `struck-${p1MoveKey}`);
					if (baseTrueFatal && m1.cost >= 4) this.triggerCinematicFinish();
					
					if (baseP2TriggersBalance) {
						setTimeout(() => {
							p2El.classList.add('anim-teeter');
							sound.play('teeter');
							if (baseP2CardsNeeded > 0) {
								for (let i = 0; i < baseP2CardsNeeded; i++) {
									if (typeof game !== 'undefined') game.activateCardEffect(2, 'suri_ashi', i, baseP2CardsNeeded); 
									else this.activateCardEffect(2, 'suri_ashi', i, baseP2CardsNeeded);
								}
							}
						}, 200 * this.timeMult);
					}
                    
                    this.jitterHPBar(2);
					triggerDynamicMuffle(m1);
					
					if (p1TsuppariCount > 0) executeProjectileBarrage(1, m1.dmg, p1TsuppariCount, p1MoveKey, p2RecoveryWiggle, 'tsuppari');
                }, hitDelay);
            } else if (m2.dmg > m1.dmg) {
                d1 = m2.dmg;
                log += `P2's ${styledM2} <span style="color:var(--accent-red)">OVERPOWERS</span> P1! `;
				
				if (p2TsuppariCount > 0) {
					d1 += p2TsuppariCount;
					log += `<br><span style="color:#9b59b6; font-weight:900;">TSUPPARI!</span> P2 deals +${p2TsuppariCount} Damage! `;
					for(let i=0; i<p2TsuppariCount; i++) {
						if (typeof game !== 'undefined') game.activateCardEffect(2, 'tsuppari', i, p2TsuppariCount);
						else this.activateCardEffect(2, 'tsuppari', i, p2TsuppariCount);
					}
				}
                
                p2El.classList.add('anim-' + p2MoveKey);
                if (p2MoveKey === 'utchari') setTimeout(() => this.spawnDust(2, 'utchari'), 720 * this.timeMult);
                if (p2MoveKey === 'nodowa') setTimeout(() => this.spawnDust(2, 'nodowa'), 1000 * this.timeMult);
                
                setTimeout(() => {
                    if (p1BuildAnim) p1El.classList.remove(p1BuildAnim);
                    
                    this.shatterBadge(1);
                    this.performImpactEffects(m2);
                    
					const baseP1FinalHP = this.p1.hp - m2.dmg;
					const baseP1TriggersBalance = baseP1FinalHP === 0 || (baseP1FinalHP < 0 && baseP1FinalHP >= -p1RecoveryWiggle);
					const baseP1CardsNeeded = baseP1FinalHP < 0 ? Math.ceil(Math.abs(baseP1FinalHP) / 2) : 0;
					const baseTrueFatal = baseP1FinalHP < 0 && !baseP1TriggersBalance;
					
					p1El.classList.add('hit-anim', baseTrueFatal ? `fatal-${p2MoveKey}` : `struck-${p2MoveKey}`);
					if (baseTrueFatal && m2.cost >= 4) this.triggerCinematicFinish();
					
					if (baseP1TriggersBalance) {
						setTimeout(() => {
							p1El.classList.add('anim-teeter');
							sound.play('teeter');
							if (baseP1CardsNeeded > 0) {
								for (let i = 0; i < baseP1CardsNeeded; i++) {
									if (typeof game !== 'undefined') game.activateCardEffect(1, 'suri_ashi', i, baseP1CardsNeeded);
									else this.activateCardEffect(1, 'suri_ashi', i, baseP1CardsNeeded);
								}
							}
						}, 200 * this.timeMult);
					}

                    this.jitterHPBar(1);
					triggerDynamicMuffle(m2);
					
					if (p2TsuppariCount > 0) executeProjectileBarrage(2, m2.dmg, p2TsuppariCount, p2MoveKey, p1RecoveryWiggle, 'tsuppari');
                }, hitDelay);
            } else {
                const clashTier = Math.min(4, Math.max(0, m1.cost || 0));
                log += `Massive Clash! Tier ${clashTier} forces cancel out! `;
                
                p1El.classList.add(`anim-clash-t${clashTier}`);
                p2El.classList.add(`anim-clash-t${clashTier}`);
                
                const clashImpactTime = hitDelay * 0.35;

                this.triggerWindGust(1, m1.dmg, clashImpactTime);
                this.triggerWindGust(2, m2.dmg, clashImpactTime);

                setTimeout(() => {
                    if (clashTier === 4) {
						triggerDynamicMuffle(m1);
                        sound.play('boom');
                        setTimeout(() => sound.play('thwack'), 50);
                        document.body.classList.add('shake-active');
                        setTimeout(() => document.body.classList.remove('shake-active'), 300);
                        
                        const flash = document.getElementById('hit-flash');
                        if(flash) {
                            flash.classList.add('flash-super');
                            setTimeout(() => flash.classList.remove('flash-super'), 250);
                        }
                    } else if (clashTier === 3) {
						triggerDynamicMuffle(m1);
                        sound.play('boom');
                        document.body.classList.add('shake-active');
                        setTimeout(() => document.body.classList.remove('shake-active'), 200);
                    } else if (clashTier >= 1) {
                        sound.play('thwack');
                    } else {
                        sound.play('block');
                    }
                    this.shatterBadge(1);
                    this.shatterBadge(2);
                }, clashImpactTime);
            }
        } else {
            if (p1Atk) {
                const atkHeight = m1.type.split('_')[1]; 
                const isBlock = m2.type.includes('def');
                const blockHeight = isBlock ? m2.type.split('_')[1] : null;
                const isPunished = m2.name === "Build Momentum"; 
                
                p1El.classList.add('anim-' + p1MoveKey);
                if (p1MoveKey === 'utchari') setTimeout(() => this.spawnDust(1, 'utchari'), 720 * this.timeMult);
                if (p1MoveKey === 'nodowa') setTimeout(() => this.spawnDust(1, 'nodowa'), 1000 * this.timeMult);

               if (isBlock && blockHeight === atkHeight) {
					log += `P2 Blocks ${styledM1}! `;
					d2 = 0; p2Perfect = true;
					
					const soppCount = getHoldCount(2, 'soppugata');
					if (soppCount > 0) {
						this.lastDamageSource = 'recoil';
						d1 += soppCount; 
						log += `<br><span style="color:#9b59b6; font-weight:900;">SOPPUGATA!</span> P1 takes <strong>Recoil Damage x${soppCount}</strong>! `;
						
						for (let i = 0; i < soppCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(2, 'soppugata', i, soppCount);
							else this.activateCardEffect(2, 'soppugata', i, soppCount);
						}
					}
					
					const p2HasA = getHoldCount(2, 'a_gyo') > 0;
					const p2HasUn = getHoldCount(2, 'un_gyo') > 0;
					
					const oppName = this.currentOpponentName || "";
					const isYokozuna = this.mode === 'cpu' && oppName.includes('Yokozuna');
					const yokozunaProc = isYokozuna && Math.random() < 0.75;
					
					if ((p2HasA && p2HasUn) || yokozunaProc) {
						if (!this.p1.disabledMoves) this.p1.disabledMoves = [];
						if (!this.p1.disabledMoves.includes(p1MoveKey)) {
							this.p1.disabledMoves.push(p1MoveKey);
							
							if (yokozunaProc && !(p2HasA && p2HasUn)) {
								log += `<br><span style="color:#e74c3c; font-weight:900;">DIVINE PRESENCE! Yokozuna seals P1's ${styledM1}!</span> `;
							} else {
								log += `<br><span style="color:#e74c3c; font-weight:900;">A-UN SEAL! P1's ${styledM1} is sealed!</span> `;
							}
							
							setTimeout(() => this.triggerSealAnimation(1, p1MoveKey), hitDelay + 200);							
							setTimeout(() => { if (typeof game !== 'undefined') game.activateCardEffect(2, 'a_gyo', 0, 1, true); }, hitDelay + 400);
							setTimeout(() => { if (typeof game !== 'undefined') game.activateCardEffect(2, 'un_gyo', 1, 1, true); }, hitDelay + 600);
						}
					}

					setTimeout(() => {
						sound.play('block');
						const s = document.getElementById('p2-perfect-shield');
						if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
						
						const randBlock = Math.floor(Math.random() * 3) + 1;
						p2El.classList.add(`anim-block-${blockHeight}-${randBlock}`);
						
						// --- THE FIX: LAUNCH THE SOPPUGATA BARRAGE ---
						if (soppCount > 0) {
							// Base damage dealt from P2 to P1 is 0 prior to the recoil!
							executeProjectileBarrage(2, 0, soppCount, p1MoveKey, p1RecoveryWiggle, 'soppugata');
						}
					}, hitDelay);
				} else {
					const baseDmg = isBlock ? Math.max(1, Math.ceil(m1.dmg * 0.5)) : (isPunished ? Math.floor(m1.dmg * 1.5) : m1.dmg);
					d2 = baseDmg;
                    log += isBlock ? `P2 Partial Block! ` : (isPunished ? `<span style="color:var(--accent-red); font-weight:900;">COUNTER!</span> ` : "");
                    
					if (p1TsuppariCount > 0) {
						d2 += p1TsuppariCount;
						log += `<br><span style="color:#9b59b6; font-weight:900;">TSUPPARI!</span> P1 deals +${p1TsuppariCount} Damage! `;
						for(let i=0; i<p1TsuppariCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(1, 'tsuppari', i, p1TsuppariCount);
							else this.activateCardEffect(1, 'tsuppari', i, p1TsuppariCount);
						}
					}

                    setTimeout(() => {
                        if (p2BuildAnim) p2El.classList.remove(p2BuildAnim);
                        this.performImpactEffects(m1);
                        
						const baseP2FinalHP = this.p2.hp - baseDmg;
						const baseP2TriggersBalance = baseP2FinalHP === 0 || (baseP2FinalHP < 0 && baseP2FinalHP >= -p2RecoveryWiggle);
						const baseP2CardsNeeded = baseP2FinalHP < 0 ? Math.ceil(Math.abs(baseP2FinalHP) / 2) : 0;
						const baseTrueFatal = baseP2FinalHP < 0 && !baseP2TriggersBalance;
						
						p2El.classList.add('hit-anim', baseTrueFatal ? `fatal-${p1MoveKey}` : `struck-${p1MoveKey}`);
						if (baseTrueFatal && m1.cost >= 4) this.triggerCinematicFinish();
						
						if (baseP2TriggersBalance) {
							setTimeout(() => {
								p2El.classList.add('anim-teeter');
								sound.play('teeter');
								if (baseP2CardsNeeded > 0) {
									for (let i = 0; i < baseP2CardsNeeded; i++) {
										if (typeof game !== 'undefined') game.activateCardEffect(2, 'suri_ashi', i); 
										else this.activateCardEffect(2, 'suri_ashi', i);
									}
									log += `<br><span style="color:#9b59b6; font-weight:bold;">P2's SURI-ASHI x${baseP2CardsNeeded} triggers Balance Check!</span> `;
								}
							}, 200 * this.timeMult);
						}                       
                        this.jitterHPBar(2);
						triggerDynamicMuffle(m1);
						
						if (p1TsuppariCount > 0) executeProjectileBarrage(1, baseDmg, p1TsuppariCount, p1MoveKey, p2RecoveryWiggle, 'tsuppari');
                    }, hitDelay);
                }
            }
            if (p2Atk) {
                const atkHeight = m2.type.split('_')[1];
                const isBlock = m1.type.includes('def');
                const blockHeight = isBlock ? m1.type.split('_')[1] : null;
                const isPunished = m1.name === "Build Momentum";
                
                p2El.classList.add('anim-' + p2MoveKey);
                if (p2MoveKey === 'utchari') setTimeout(() => this.spawnDust(2, 'utchari'), 720 * this.timeMult);
                if (p2MoveKey === 'nodowa') setTimeout(() => this.spawnDust(2, 'nodowa'), 1000 * this.timeMult);

               if (isBlock && blockHeight === atkHeight) {
					log += `P1 Blocks ${styledM2}! `;
					d1 = 0; p1Perfect = true;
					
					const soppCount = getHoldCount(1, 'soppugata');
					if (soppCount > 0) {
						d2 += soppCount; 
						this.lastDamageSource = 'recoil';
						log += `<br><span style="color:#9b59b6; font-weight:900;">SOPPUGATA!</span> P2 takes <strong>${soppCount} Recoil Damage</strong>! `;
						
						for (let i = 0; i < soppCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(1, 'soppugata', i, soppCount);
							else this.activateCardEffect(1, 'soppugata', i, soppCount);
						}
					}
					
					const p1HasA = getHoldCount(1, 'a_gyo') > 0;
					const p1HasUn = getHoldCount(1, 'un_gyo') > 0;
					
					if (p1HasA && p1HasUn) {
						if (!this.p2.disabledMoves) this.p2.disabledMoves = [];
						if (!this.p2.disabledMoves.includes(p2MoveKey)) {
							this.p2.disabledMoves.push(p2MoveKey);
							log += `<br><span style="color:#e74c3c; font-weight:900;">A-UN SEAL! P2's ${styledM2} is sealed!</span> `;
							
							setTimeout(() => this.triggerSealAnimation(2, p2MoveKey), hitDelay + 200);
							setTimeout(() => game.activateCardEffect(1, 'a_gyo', 0, 1, true), hitDelay + 400);
							setTimeout(() => game.activateCardEffect(1, 'un_gyo', 1, 1, true), hitDelay + 600);
						}
					}

					setTimeout(() => {
						sound.play('block');
						const s = document.getElementById('p1-perfect-shield');
						if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
						
						const randBlock = Math.floor(Math.random() * 3) + 1;
						p1El.classList.add(`anim-block-${blockHeight}-${randBlock}`);
						
						// --- THE FIX: LAUNCH THE SOPPUGATA BARRAGE ---
						if (soppCount > 0) {
							executeProjectileBarrage(1, 0, soppCount, p2MoveKey, p2RecoveryWiggle, 'soppugata');
						}
					}, hitDelay);
                } else {
					const baseDmg = isBlock ? Math.max(1, Math.ceil(m2.dmg * 0.5)) : (isPunished ? Math.floor(m2.dmg * 1.5) : m2.dmg);
					d1 = baseDmg;
                    log += isBlock ? `P1 Partial Block! ` : (isPunished ? `<span style="color:var(--accent-red); font-weight:900;">COUNTER!</span> ` : "");
                    
					if (p2TsuppariCount > 0) {
						d1 += p2TsuppariCount;
						log += `<br><span style="color:#9b59b6; font-weight:900;">TSUPPARI!</span> P2 deals +${p2TsuppariCount} Damage! `;
						for(let i=0; i<p2TsuppariCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(2, 'tsuppari', i, p2TsuppariCount);
							else this.activateCardEffect(2, 'tsuppari', i, p2TsuppariCount);
						}
					}

                    setTimeout(() => {
                        if (p1BuildAnim) p1El.classList.remove(p1BuildAnim);
                        this.performImpactEffects(m2);

						const baseP1FinalHP = this.p1.hp - baseDmg;
						const baseP1TriggersBalance = baseP1FinalHP === 0 || (baseP1FinalHP < 0 && baseP1FinalHP >= -p1RecoveryWiggle);
						const baseP1CardsNeeded = baseP1FinalHP < 0 ? Math.ceil(Math.abs(baseP1FinalHP) / 2) : 0;
						const baseTrueFatal = baseP1FinalHP < 0 && !baseP1TriggersBalance;
						
						p1El.classList.add('hit-anim', baseTrueFatal ? `fatal-${p2MoveKey}` : `struck-${p2MoveKey}`);
						if (baseTrueFatal && m2.cost >= 4) this.triggerCinematicFinish();
						
						if (baseP1TriggersBalance) {
							setTimeout(() => {
								p1El.classList.add('anim-teeter');
								sound.play('teeter');
								if (baseP1CardsNeeded > 0) {
									for (let i = 0; i < baseP1CardsNeeded; i++) {
										if (typeof game !== 'undefined') game.activateCardEffect(1, 'suri_ashi', i);
										else this.activateCardEffect(1, 'suri_ashi', i);
									}
									log += `<br><span style="color:#9b59b6; font-weight:bold;">P1's SURI-ASHI x${baseP1CardsNeeded} triggers Balance Check!</span> `;
								}
							}, 200 * this.timeMult);
						}
                        this.jitterHPBar(1);
						triggerDynamicMuffle(m2);
						
						if (p2TsuppariCount > 0) executeProjectileBarrage(2, baseDmg, p2TsuppariCount, p2MoveKey, p1RecoveryWiggle, 'tsuppari');
                    }, hitDelay);
                }
            }
            if (!p1Atk && !p2Atk) {
                setTimeout(() => sound.play('whiff'), 1000*this.timeMult);
            }
        }
            
        const p1AttackSucceeded = p1Atk && (!p2Atk || m1.dmg > m2.dmg);
        const p2AttackSucceeded = p2Atk && (!p1Atk || m1.dmg < m2.dmg);

        if (p1AttackSucceeded && m1.guardBreak) {
			const gbAmount = m1.guardBreak;
			if (this.p2.mom > 0) {
				const p2MawashiCount = getHoldCount(2, 'mawashi_grip');
				if (p2MawashiCount > 0) {
					const localPNum = (this.mode === 'online' && typeof net !== 'undefined' && net.side === 'join') ? 2 : 1;
					if (m1.cost >= 4 && (this.mode === 'local' || localPNum === 2)) {
						this.unlockAchievement('taka_no_me');
					}
					log += `<br><span style="color:#9b59b6; font-weight:900;">ANCHORED!</span> P2's Mawashi-Grip absorbs the Guard Break! `;
					setTimeout(() => {
						for (let i = 0; i < p2MawashiCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(2, 'mawashi_grip', i, p2MawashiCount);
							else this.activateCardEffect(2, 'mawashi_grip', i, p2MawashiCount);
						}
					}, hitDelay);
				} else {
					const actualLoss = Math.min(this.p2.mom, gbAmount);
					this.p2.mom = Math.max(0, this.p2.mom - gbAmount);
					log += `<br><span style="color:var(--accent-red)">P1 Guard Break! P2 loses ${gbAmount} Mom.</span> `;
					
					setTimeout(() => {
						this.spawnMomentumLossIcon(2); 
						sound.play('powerdown');
						this.shatterMomentumPips(2, actualLoss);
					}, hitDelay);
				}
			}
		}

		if (p2AttackSucceeded && m2.guardBreak) {
			const gbAmount = m2.guardBreak;
			if (this.p1.mom > 0) {
				const p1MawashiCount = getHoldCount(1, 'mawashi_grip');
				if (p1MawashiCount > 0) {
					const localPNum = (this.mode === 'online' && typeof net !== 'undefined' && net.side === 'join') ? 2 : 1;
					if (m2.cost >= 4 && (this.mode === 'local' || localPNum === 1)) {
						this.unlockAchievement('taka_no_me');
					}
					log += `<br><span style="color:#9b59b6; font-weight:900;">ANCHORED!</span> P1's Mawashi-Grip absorbs the Guard Break! `;
					setTimeout(() => {
						for (let i = 0; i < p1MawashiCount; i++) {
							if (typeof game !== 'undefined') game.activateCardEffect(1, 'mawashi_grip', i, p1MawashiCount);
							else this.activateCardEffect(1, 'mawashi_grip', i, p1MawashiCount);
						}
					}, hitDelay);
				} else {
					const actualLoss = Math.min(this.p1.mom, gbAmount);
					this.p1.mom = Math.max(0, this.p1.mom - gbAmount);
					log += `<br><span style="color:var(--accent-red)">P2 Guard Break! P1 loses ${gbAmount} Mom.</span> `;
					
					setTimeout(() => {
						this.spawnMomentumLossIcon(1); 
						sound.play('powerdown'); 
						this.shatterMomentumPips(1, actualLoss);
					}, hitDelay);
				}
			}
		}
        
        if (d2 > 0) this.triggerWindGust(1, d2, hitDelay); 
        if (d1 > 0) this.triggerWindGust(2, d1, hitDelay);
        
        setTimeout(() => {
            if (d1 > 0 || d2 > 0) {
                const tempP1Hp = this.p1.hp; const tempP2Hp = this.p2.hp;
                this.p1.hp -= d1; this.p2.hp -= d2;
                this.updateWindBalance();
                this.p1.hp = tempP1Hp; this.p2.hp = tempP2Hp;
            }
        }, hitDelay);
        
		const p1FinalHP = this.p1.hp - d1;
		const p2FinalHP = this.p2.hp - d2;
		
		const p1TriggersBalance = p1FinalHP === 0 || (p1FinalHP < 0 && p1FinalHP >= -p1RecoveryWiggle);
		const p2TriggersBalance = p2FinalHP === 0 || (p2FinalHP < 0 && p2FinalHP >= -p2RecoveryWiggle);

		const isBalanceCheck = p1TriggersBalance || p2TriggersBalance;
		const isMatchOver = (p1FinalHP < 0 && !p1TriggersBalance) || (p2FinalHP < 0 && !p2TriggersBalance);
		
		if (isBalanceCheck) {
			const attackerNum = p1TriggersBalance ? 2 : 1;
			const attackerEl = attackerNum === 1 ? p1El : p2El;
			const fatalMove = p1TriggersBalance ? m2 : m1;
			const attackTier = fatalMove.cost || 0;

			if (attackTier >= 3) {
				attackerEl.style.setProperty('--atk-dir', attackerNum === 1 ? '1' : '-1');
				setTimeout(() => {
					attackerEl.classList.add('anim-struggle-push');
				}, (baseDelay + 200) * this.timeMult);
			}
		}
        
		// --- THE FIX: ADD SOPPUGATA TO THE MAXIMUM WAIT TIME CALCULATION ---
		const soppCount1 = getHoldCount(1, 'soppugata');
		const soppCount2 = getHoldCount(2, 'soppugata');

		let maxProjectileTime = 0;
		if (d2 > 0 && p1TsuppariCount > 0 && p1Atk) maxProjectileTime = Math.max(maxProjectileTime, 350 + (p1TsuppariCount * 250) + 200);
		if (d1 > 0 && p2TsuppariCount > 0 && p2Atk) maxProjectileTime = Math.max(maxProjectileTime, 350 + (p2TsuppariCount * 250) + 200);
		if (d2 > 0 && p1Perfect && soppCount1 > 0) maxProjectileTime = Math.max(maxProjectileTime, 350 + (soppCount1 * 250) + 200);
		if (d1 > 0 && p2Perfect && soppCount2 > 0) maxProjectileTime = Math.max(maxProjectileTime, 350 + (soppCount2 * 250) + 200);
		
        let finalDelay = 2000 + maxProjectileTime;
        if (isBalanceCheck) {
            finalDelay = baseDelay + 200 + maxProjectileTime; 
        } else if (isMatchOver) {
            finalDelay = 2600 + maxProjectileTime;
        }
        
        setTimeout(() => {
			if (this.mode === 'cpu') {
				if (p1TriggersBalance) return this.startBalanceCheck(1, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
				if (p2TriggersBalance) return this.startCPUBalanceCheck(2, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
			} else {
				if (p1TriggersBalance) return this.startBalanceCheck(1, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
				if (p2TriggersBalance) return this.startBalanceCheck(2, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
			}

            this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);

        }, finalDelay * this.timeMult);
    },
	
	spawnSweat: function(playerNum) {
		const el = document.getElementById(`p${playerNum}-rikishi`);
		if (!el) return;
		
		const sweat = document.createElement('div');
		sweat.className = 'sweat-bead';
		
		// If it's Player 2, flip the horizontal positioning so it matches their orientation
		if (playerNum === 2) sweat.style.left = '40%';
		
		el.appendChild(sweat);
		
		// Clean up the DOM after the animation finishes
		setTimeout(() => sweat.remove(), 2000);
	},
		
	getDamageFlavor: function(dmg) {
		if (dmg <= 0) return 'no'; // Just in case a zero-damage move sneaks through!

		let words = [];
		
		if (dmg <= 2) {
			words = ['light', 'minor', 'glancing', 'grazing', 'slight'];
		} else if (dmg <= 4) {
			words = ['moderate', 'mild', 'solid', 'stiff', 'clean'];
		} else if (dmg <= 6) {
			words = ['punishing', 'harsh', 'heavy', 'brutal', 'fierce'];
		} else if (dmg <= 8) {
			words = ['crippling', 'outstanding', 'crushing', 'vicious', 'staggering'];
		} else {
			// 9+ Damage (The Ultimates)
			words = ['devastating', 'phenomenal', 'catastrophic', 'ruinous', 'massive'];
		}

		// Pick a random word from the selected array
		const selectedWord = words[Math.floor(Math.random() * words.length)];
		
		// Grammatical check: Does it need 'an' instead of 'a'?
		const vowels = ['a', 'e', 'i', 'o', 'u'];
		const article = vowels.includes(selectedWord[0]) ? 'an' : 'a';
		
		return `${article} ${selectedWord}`;
	},
    
    // --- NEW FUNCTION: FINALIZE TURN
    finalizeTurnResolution: function(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log) {
		const getHoldCount = (pNum, type) => {
			const p = pNum === 1 ? this.p1 : this.p2;
			const isLocal = (this.mode !== 'online') || (typeof net !== 'undefined' && net.side === 'host' ? pNum === 1 : pNum === 2);
			if (isLocal) return p.hand ? p.hand.filter(c => c.type === type).length : 0;
			return p.networkHandTypes ? p.networkHandTypes.filter(t => t === type).length : 0;
		};

		this.p1.hp = Math.max(0, this.p1.hp - d1);
		if (d1 > 0) this.stats.total_damage_taken = (this.stats.total_damage_taken || 0) + d1; 
		this.p2.hp = Math.max(0, this.p2.hp - d2);
		
		const p1Interrupted = p1Atk || m1.type === 'util' || m2.type === 'util' || m2.type.includes('def') || (d1 > 0); 
		
		const hasActiveHold = document.querySelectorAll('#hold-effect-layer .activity-card').length > 0;
        
        if (hasActiveHold) {
            this.consecutiveHoldTurns = (this.consecutiveHoldTurns || 0) + 1;
            if (this.consecutiveHoldTurns >= 5) {
                this.unlockAchievement('keiko_master');
            }
        } else {
            // Reset the streak if a turn ends with no holds
            this.consecutiveHoldTurns = 0;
        }
		
		// --- P1 IRON WALL LOGIC ---
		if (p1Perfect) {
			const kimeCount = getHoldCount(1, 'kimedashi');
			
			// --- THE FIX: LOOP KIMEDASHI ---
			if (kimeCount > 0) {
				this.p1.ironWallGrace = 1; 
				// Loop to fan out the cards visually!
				for (let i = 0; i < kimeCount; i++) {
					if (typeof game !== 'undefined') game.activateCardEffect(1, 'kimedashi', i, kimeCount);
					else this.activateCardEffect(1, 'kimedashi', i, kimeCount);
				}
			}

			if (this.p1.streak === 0) {
				this.p1.streak = 1;
				if (kimeCount > 0) log += `<br><em style="color:var(--gold); font-weight:bold;">Iron Wall Activated... [KIMEDASHI 🛡️x2]</em>`;
				else log += `<br><em>Iron Wall Activated...</em>`;
			} else {
				this.p1.streak++;
				this.triggerExcitement(4000);
				
				if (this.p1.mom < MAX_MOM) {
					this.p1.mom++;
					this.spawnMomentumIcon(1); 
					if (typeof sound !== 'undefined') sound.play('powerup');     
				}
				this.matchStats.iron_walls++;
				
				if (kimeCount > 0) log += `<br><span style='color:var(--gold); font-weight:900;'>IRON WALL! +1 Mom [KIMEDASHI 🛡️x2]</span>`;
				else log += "<br><span style='color:var(--gold)'>IRON WALL! +1 Momentum</span>";
				
				if (this.matchStats.iron_walls >= 3) this.unlockAchievement('fudo_shin');
			}
        } else if (p1Interrupted) {
            if (this.p1.streak >= 1 && this.p1.ironWallGrace > 0) {
                this.p1.ironWallGrace--;
                log += "<br><span style='color:#aaa; font-style:italic;'>P1's Iron Wall Holds (Grace Consumed)</span>";
            } else {
                this.p1.streak = 0;
            }
        }

        // --- P2 IRON WALL LOGIC ---
        const p2Interrupted = p2Atk || m2.type === 'util' || m1.type === 'util' || m1.type.includes('def') || (d2 > 0);
		if (p2Perfect) {
			const kimeCount = getHoldCount(2, 'kimedashi');
			
			// --- THE FIX: LOOP KIMEDASHI ---
			if (kimeCount > 0) {
				this.p2.ironWallGrace = 1; 
				// Loop to fan out the cards visually!
				for (let i = 0; i < kimeCount; i++) {
					if (typeof game !== 'undefined') game.activateCardEffect(2, 'kimedashi', i, kimeCount);
					else this.activateCardEffect(2, 'kimedashi', i, kimeCount);
				}
			}

			if (this.p2.streak === 0) {
				this.p2.streak = 1;
				if (kimeCount > 0) log += `<br><em style="color:var(--gold); font-weight:bold;">Iron Wall Activated... [KIMEDASHI 🛡️x2]</em>`;
				else log += `<br><em>Iron Wall Activated...</em>`;
			} else {
				this.p2.streak++;
				this.triggerExcitement(4000);
				
				if (this.p2.mom < MAX_MOM) {
					this.p2.mom++;
					this.spawnMomentumIcon(2); 
					if (typeof sound !== 'undefined') sound.play('powerup');     
				}
				
				if (kimeCount > 0) log += `<br><span style='color:var(--gold); font-weight:900;'>IRON WALL! +1 Mom [KIMEDASHI 🛡️x2]</span>`;
				else log += "<br><span style='color:var(--gold)'>IRON WALL! +1 Momentum</span>";
			}
		} else if (p2Interrupted) {
            if (this.p2.streak >= 1 && this.p2.ironWallGrace > 0) {
                this.p2.ironWallGrace--;
                log += "<br><span style='color:#aaa; font-style:italic;'>P2's Iron Wall Holds (Grace Consumed)</span>";
            } else {
                this.p2.streak = 0;
            }
        }

        this.updateHUD(); 
        
        // --- THE PLAY-BY-PLAY ANNOUNCER ---
        let announcerText = "";

        // Determine colors based on high/low move types
        const m1Color = m1.type && m1.type.includes('low') ? 'var(--gold)' : 'white';
        const m2Color = m2.type && m2.type.includes('low') ? 'var(--gold)' : 'white';

        // Styled badges
        const styledM1 = `<span class="move-badge in-log move-${p1MoveKey}" style="color: ${m1Color};">${m1.name}</span>`;
        const styledM2 = `<span class="move-badge in-log move-${p2MoveKey}" style="color: ${m2Color};">${m2.name}</span>`;
        
        if (d2 > 0) { 
            // SCENARIO 1: P1 dealt damage, P1 took none
            const p1Wins = [
                `P1 executes a flawless ${styledM1}, dealing ${this.getDamageFlavor(d2)} blow!`,
                `A crushing ${styledM1} from P1! P2 suffers ${this.getDamageFlavor(d2)} loss of Will.`,
                `P2 is caught off guard by P1's ${styledM1}, suffering ${this.getDamageFlavor(d2)} hit!`,
                `P1 drives forward with a ${styledM1}, punishing P2 with ${this.getDamageFlavor(d2)} strike!`,
                `Incredible power! P1's ${styledM1} slams P2 for ${this.getDamageFlavor(d2)} Will loss.`,
                `P1 breaks through with a ${styledM1}! That's ${this.getDamageFlavor(d2)} hit against P2.`,
                `P2 staggers as P1 delivers a massive ${styledM1} (${this.getDamageFlavor(d2)} kimarite)!`,
                `A textbook ${styledM1} from P1 costs P2 ${this.getDamageFlavor(d2)} amount of Will!`,
                `P1 seizes the momentum! A beautiful ${styledM1} hits with ${this.getDamageFlavor(d2)} impact.`,
                `The crowd roars as P1's ${styledM1} connects for ${this.getDamageFlavor(d2)} blow!`
            ];
            announcerText = p1Wins[Math.floor(Math.random() * p1Wins.length)];
            
        } else if (d1 > 0) { 
            // SCENARIO 2: P2 dealt damage, P2 took none
            const p2Wins = [
                `P2 executes a flawless ${styledM2}, dealing ${this.getDamageFlavor(d1)} blow!`,
                `A crushing ${styledM2} from P2! P1 suffers ${this.getDamageFlavor(d1)} loss of Will.`,
                `P1 is caught off guard by P2's ${styledM2}, suffering ${this.getDamageFlavor(d1)} hit!`,
                `P2 drives forward with a ${styledM2}, punishing P1 with ${this.getDamageFlavor(d1)} strike!`,
                `Incredible power! P2's ${styledM2} slams P1 for ${this.getDamageFlavor(d1)} Will loss.`,
                `P2 breaks through with a ${styledM2}! That's ${this.getDamageFlavor(d1)} hit against P1.`,
                `P1 staggers as P2 delivers a massive ${styledM2} (${this.getDamageFlavor(d1)} kimarite)!`,
                `A textbook ${styledM2} from P2 costs P1 ${this.getDamageFlavor(d1)} amount of Will!`,
                `P2 seizes the momentum! A beautiful ${styledM2} hits with ${this.getDamageFlavor(d1)} impact.`,
                `The crowd roars as P2's ${styledM2} connects for ${this.getDamageFlavor(d1)} blow!`
            ];
            announcerText = p2Wins[Math.floor(Math.random() * p2Wins.length)];
            
        } else { 
            // SCENARIO 3: Zero damage on both sides (Blocks, clashes, or whiffs)
            const ties = [
                `A tense stalemate! Neither gives an inch.`,
                `P1's ${styledM1} meets P2's ${styledM2} in the center! No damage done.`,
                `Both rikishi stand their ground! The tension builds...`,
                `A rock-solid defense from both sides!`,
                `P1 and P2 lock horns! The match remains deadlocked.`,
                `An incredible display of balance! Neither takes a hit.`,
                `The crowd holds its breath as both fighters reposition.`,
                `A clash of wills! ${styledM1} and ${styledM2} result in a draw.`,
                `Dust settles in the dohyo. Zero damage on this exchange.`,
                `Neither rikishi finds an opening! A pure battle of attrition.`
            ];
            announcerText = ties[Math.floor(Math.random() * ties.length)];
        }

        // Combine the mechanical log with the announcer flavor text
		let finalMessage = log ? `${log} <br>` : "";
		finalMessage += `<span style="color:#666; font-style:italic;">"${announcerText}"</span>`;
		
		this.log(finalMessage);
		
		// --- THE FIX: LIFECYCLE OF DEBUFFS ---
		// 1. Sentence Served: Decrement any active penalties that were served during THIS round.
		if (this.p1.cyclePenalty > 0) this.p1.cyclePenalty--;
		if (this.p2.cyclePenalty > 0) this.p2.cyclePenalty--;

		// 2. The Bridge: Convert pending debuffs into active debuffs for the NEXT round!
		if (this.p1.pendingCyclePenalty > 0) {
			this.p1.cyclePenalty = (this.p1.cyclePenalty || 0) + this.p1.pendingCyclePenalty;
			this.p1.pendingCyclePenalty = 0;
		}
		if (this.p2.pendingCyclePenalty > 0) {
			this.p2.cyclePenalty = (this.p2.cyclePenalty || 0) + this.p2.pendingCyclePenalty;
			this.p2.pendingCyclePenalty = 0;
		}

		// 3. Sync the HUD so badges fade out or appear dynamically at the turn boundary
		if (typeof this.renderDebuffs === 'function') {
			this.renderDebuffs(1);
			this.renderDebuffs(2);
		}
		// ------------------------------------------
		
		if (this.p1.hp <= 0 || this.p2.hp <= 0) {
			this.endGame();
		} else {
			this.resetAvatars();
			
			if (this.isTutorial) {
				this.tutorialStep++;
				this.updateTutorial();
			} else {
				this.startTurn(1); 
			}
		}
	},
	
	startBalanceCheck: function(playerNum, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log) {
		if (this.mode === 'online') {
			const amHost = net.side === 'host';
			const isMyQTE = (amHost && playerNum === 1) || (!amHost && playerNum === 2);
			
			if (!isMyQTE) {
				const targetEl = playerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
				const attackerNum = playerNum === 1 ? 2 : 1;
				const attackerEl = attackerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
				
				targetEl.classList.add('anim-teeter');
				attackerEl.classList.add('anim-struggle-push');
				
				if (this.music) this.music.setConcentrationMode(true, 0.6);
				
				this.pendingQTEParams = { d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log };
				console.log("Waiting for opponent to finish their balance check...");
				return;
			}
		}
		
		if (this.music) this.music.setConcentrationMode(true, 0.8);
		
		this.qteActive = true; 
		this.triggerExcitement(6000);

		if (!document.getElementById('qte-overlay')) {
			const qteHTML = `
				<div id="qte-overlay" class="qte-overlay">
					<div class="qte-instruction">RECOVER!</div>
					<div id="qte-dial-container" class="qte-dial-container">
						<div id="qte-needle-pivot" class="qte-needle-pivot">
							<div class="qte-needle"></div>
						</div>
					</div>
				</div>
			`;
			document.getElementById('game-board').insertAdjacentHTML('beforeend', qteHTML);
		}

		// --- THE FIX: DETERMINE IF THE ACTIVE PLAYER HAS HASSOTOBI IN HAND ---
		let hasGoldUpgrade = false;
		const p = playerNum === 1 ? this.p1 : this.p2;
		
		let hassoIndex = -1;
		if (p && p.hand) {
			// Find the Hassotobi card in hand
			hassoIndex = p.hand.findIndex(c => c.key === 'hassotobi' || c.type === 'hassotobi');
		}

		if (hassoIndex !== -1) {
			hasGoldUpgrade = true;
			// THE FIX: Pass the string 'hassotobi' instead of the array index!
			if (typeof this.activateCardEffect === 'function') {
				this.activateCardEffect(playerNum, 'hassotobi');
			}
		}

		const incomingCost = playerNum === 1 ? (m2.cost || 0) : (m1.cost || 0);
		const survivedCount = playerNum === 1 ? (this.matchStats.p1BalanceChecksSurvived || 0) : (this.matchStats.p2BalanceChecksSurvived || 0);

		const tickDuration = Math.max(250, 600 - (incomingCost * 80)); 
		let successThreshold = Math.min(0.95, 0.80 + (survivedCount * 0.06)); 
		let goldThreshold = successThreshold + ((1 - successThreshold) * 0.8); // Gold is the top 20% of the Green Zone
		const zoneWidthPercent = (1 - successThreshold) * 100;

        const qteEl = document.getElementById('qte-overlay');
        const pivotEl = document.getElementById('qte-needle-pivot');
        qteEl.className = `qte-overlay show ${playerNum === 1 ? 'left-side' : 'right-side'}`;
        
        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        const arcTotalDegrees = 120;
        
        const bgLength = (arcTotalDegrees / 360) * circumference;
        const targetDegrees = (zoneWidthPercent / 100) * arcTotalDegrees;
        const targetLength = (targetDegrees / 360) * circumference;
        const targetStartDegree = -150 + ((arcTotalDegrees - targetDegrees) / 2);

        const borderDegrees = targetDegrees + 6; 
        const borderLength = (borderDegrees / 360) * circumference;
        const borderStartDegree = -150 + ((arcTotalDegrees - borderDegrees) / 2);

        let existingSvg = document.getElementById('qte-svg-dial');
        if (existingSvg) existingSvg.remove();

        // --- NEW: DRAW GOLDEN SVG BAND ---
        let goldSVG = '';
        if (hasGoldUpgrade) {
            const goldWidthPercent = (1 - goldThreshold) * 100;
            const goldDegrees = (goldWidthPercent / 100) * arcTotalDegrees;
            const goldLength = (goldDegrees / 360) * circumference;
            const goldStartDegree = -150 + ((arcTotalDegrees - goldDegrees) / 2);
            goldSVG = `<circle id="qte-gold-zone" cx="50" cy="50" r="40" fill="none" stroke="#ffd700" stroke-width="12" stroke-dasharray="${goldLength} ${circumference}" transform="rotate(${goldStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />`;
        }

        const svgHTML = `
            <svg id="qte-svg-dial" class="qte-svg-dial" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="12" stroke-dasharray="${bgLength} ${circumference}" transform="rotate(-150 50 50)" stroke-linecap="round"/>
                <circle id="qte-border-zone" cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 255, 255, 0.9)" stroke-width="14" stroke-dasharray="${borderLength} ${circumference}" transform="rotate(${borderStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />
                <circle id="qte-green-zone" cx="50" cy="50" r="40" fill="none" stroke="var(--pastel-green)" stroke-width="12" stroke-dasharray="${targetLength} ${circumference}" transform="rotate(${targetStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />
                ${goldSVG}
            </svg>
        `;
        document.getElementById('qte-dial-container').insertAdjacentHTML('afterbegin', svgHTML);

        const maxTicks = Math.floor(Math.random() * 4) + 3; 
        let accumulatedScore = 0;
        let currentTick = 0;
        let goldHits = 0; // NEW: Track perfect taps
        const scoreToPass = maxTicks * successThreshold;
        
        let startTime = performance.now();
        let lastTickIndex = 0;
        let isEnding = false; 

        let lastTapTime = 0;
        let nextTimeoutDelay = tickDuration * 10; 

        const processTap = (isTimeout = false) => {
            let score = 0;
            let isSuccess = false;
            let isGold = false;

            if (isTimeout) {
                score = 0;
                isSuccess = false;
            } else {
                const elapsed = performance.now() - startTime;
                const progress = (elapsed % (tickDuration * 2)) / tickDuration;
                const position = progress <= 1 ? progress : 2 - progress;
                
                const distFromCenter = Math.abs(position - 0.5);
                score = Math.max(0, 1 - (distFromCenter * 2));
                isSuccess = score > successThreshold;
                isGold = hasGoldUpgrade && score >= goldThreshold;
                if (isGold) goldHits++;
            }

            accumulatedScore += score;
			this.spawnFeedbackParticle(isSuccess, isGold);

			if (isGold) {
				if (typeof sound !== 'undefined') sound.play('qte_gold');
			} else if (isSuccess) {
				if (typeof sound !== 'undefined') sound.play('qte_success');
			} else {
				if (typeof sound !== 'undefined') sound.play('qte_fail');
			}

            currentTick++;
            const remainingTicks = maxTicks - currentTick;
            const maxPossibleScore = accumulatedScore + remainingTicks;

            if (maxPossibleScore < scoreToPass || currentTick >= maxTicks) {
                isEnding = true; 
                endQTE(); 
                return;
            }

            // DYNAMIC SHRINKING LOGIC
            if (remainingTicks > 0) {
                const neededScore = scoreToPass - accumulatedScore;
                const requiredAverage = neededScore / remainingTicks;

                if (requiredAverage > successThreshold && requiredAverage <= 1.0) {
                    successThreshold = requiredAverage;
                    
                    const newZoneWidth = (1 - successThreshold) * 100;
                    const newTargetDeg = (newZoneWidth / 100) * arcTotalDegrees;
                    const newTargetLen = (newTargetDeg / 360) * circumference;
                    const newStartDeg = -150 + ((arcTotalDegrees - newTargetDeg) / 2);

                    const newBorderDeg = newTargetDeg + 6;
                    const newBorderLen = (newBorderDeg / 360) * circumference;
                    const newBorderStart = -150 + ((arcTotalDegrees - newBorderDeg) / 2);

                    const greenZone = document.getElementById('qte-green-zone');
                    const borderZone = document.getElementById('qte-border-zone');

                    if (greenZone && borderZone) {
                        greenZone.setAttribute('stroke-dasharray', `${newTargetLen} ${circumference}`);
                        greenZone.setAttribute('transform', `rotate(${newStartDeg} 50 50)`);
                        borderZone.setAttribute('stroke-dasharray', `${newBorderLen} ${circumference}`);
                        borderZone.setAttribute('transform', `rotate(${newBorderStart} 50 50)`);
                    }

                    // SHRINK THE GOLD ZONE PROPORTIONALLY
                    if (hasGoldUpgrade) {
                        goldThreshold = successThreshold + ((1 - successThreshold) * 0.6);
                        const newGoldWidthPercent = (1 - goldThreshold) * 100;
                        const newGoldDegrees = (newGoldWidthPercent / 100) * arcTotalDegrees;
                        const newGoldLength = (newGoldDegrees / 360) * circumference;
                        const newGoldStart = -150 + ((arcTotalDegrees - newGoldDegrees) / 2);
                        const goldZone = document.getElementById('qte-gold-zone');
                        if (goldZone) {
                            goldZone.setAttribute('stroke-dasharray', `${newGoldLength} ${circumference}`);
                            goldZone.setAttribute('transform', `rotate(${newGoldStart} 50 50)`);
                        }
                    }
                }
            }
        };

        const handleTap = (e) => {
            if (e.type === 'keydown' && e.code !== 'Space') return;
            if (!this.qteActive || isEnding) return; 
            lastTapTime = performance.now() - startTime;
            nextTimeoutDelay = tickDuration * 2; 
            processTap(false);
        };

        window.addEventListener('keydown', handleTap);
        document.getElementById('game-board').addEventListener('pointerdown', handleTap);

        const animateNeedle = (currentTime) => {
            if (!this.qteActive || isEnding) return; 
            const elapsed = currentTime - startTime;

            if (elapsed - lastTapTime > nextTimeoutDelay) {
                lastTapTime = elapsed;
                nextTimeoutDelay = tickDuration * 2;
                processTap(true); 
                if (isEnding) return; 
            }

            const progress = (elapsed % (tickDuration * 2)) / tickDuration;
            const position = progress <= 1 ? progress : 2 - progress; 
            
            const currentDeg = -60 + (position * 120);
            pivotEl.style.transform = `rotate(${currentDeg}deg)`;
            
            const currentTickIndex = Math.floor(elapsed / tickDuration);
            if (currentTickIndex > lastTickIndex) {
                if (typeof sound !== 'undefined') sound.play('click');
                lastTickIndex = currentTickIndex;
            }

            requestAnimationFrame(animateNeedle);
        };
        
        requestAnimationFrame(animateNeedle);

        const endQTE = () => {
            if (!this.qteActive) return;
            this.qteActive = false;
			
			if (this.music) this.music.setConcentrationMode(false);
			
            window.removeEventListener('keydown', handleTap);
            document.getElementById('game-board').removeEventListener('pointerdown', handleTap);
            qteEl.classList.remove('show');
            
            const passed = accumulatedScore >= scoreToPass;
            
            // --- NEW: CYBER DOHYO ACHIEVEMENT CHECK ---
            // They passed AND every single required tap was a Gold hit
            if (passed && goldHits === maxTicks) {
                // Ensure we only grant this to the person actually playing the QTE
                let isMe = false;
                if (this.mode === 'online') {
                    isMe = (net.side === 'host' && playerNum === 1) || (net.side === 'join' && playerNum === 2);
                } else {
                    isMe = (playerNum === 1); // Offline, Player 1 is always the human
                }

                if (isMe) {
                    this.unlockAchievement('perfect_balance');
                }
            }
            // ------------------------------------------
            
            // --- NEW: Sync Gold Hits to Network ---
            if (this.mode === 'online') {
                net.sendQTEResult(passed, goldHits); // Assumes you update your net script to accept the 2nd arg
            }
            
            const targetEl = playerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
            const attackerNum = playerNum === 1 ? 2 : 1;
            const attackerEl = attackerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
            
            targetEl.classList.remove('anim-teeter');
            attackerEl.classList.remove('anim-struggle-push');
			
			// --- NEW: Identify if the QTE player is the Local Human ---
            let isMe = false;
            if (this.mode === 'online') {
                isMe = (net.side === 'host' && playerNum === 1) || (net.side === 'join' && playerNum === 2);
            } else {
                isMe = (playerNum === 1); // Offline, Player 1 is always the human
            }
            
            if (passed) {
				if (isMe) {
                    this.stats.balance_checks_passed = (this.stats.balance_checks_passed || 0) + 1;
                    const b = this.stats.balance_checks_passed;
                    
                    if (b >= 1) this.unlockAchievement('balance_1');
                    if (b >= 10) this.unlockAchievement('balance_10');
                    if (b >= 25) this.unlockAchievement('balance_25');
                    if (b >= 50) this.unlockAchievement('balance_50');
                    if (b >= 100) this.unlockAchievement('balance_100');
                    if (b >= 250) this.unlockAchievement('balance_250');
                }
				
                if (playerNum === 1) this.matchStats.p1BalanceChecksSurvived = (this.matchStats.p1BalanceChecksSurvived || 0) + 1;
                if (playerNum === 2) this.matchStats.p2BalanceChecksSurvived = (this.matchStats.p2BalanceChecksSurvived || 0) + 1;

                if (hasGoldUpgrade && goldHits > 0) {
					// THE FIX: Updated text for human player!
					log += `<br><span style="color:#ffd700; text-shadow: 0 0 5px rgba(255,215,0,0.5);">HASSOTOBI! (+${goldHits} BONUS HP)</span>`;
					const p = playerNum === 1 ? this.p1 : this.p2;
						if (isMe && p.hp === 1) {
							this.unlockAchievement('tobiuo');
						}
				} else {
					log += `<br><span style="color:var(--gold)">P${playerNum} CLINGS TO THE EDGE!</span>`;
				}
                
                // Subtracting goldHits from the pending damage heals the player natively
                if (playerNum === 1) d1 = this.p1.hp - (1 + goldHits); 
                if (playerNum === 2) d2 = this.p2.hp - (1 + goldHits);
                
                targetEl.classList.add('anim-recover');
                attackerEl.classList.add('anim-struggle-rebound');
                
                setTimeout(() => {
                    targetEl.classList.remove('anim-recover');
                    attackerEl.classList.remove('anim-struggle-rebound');
                    this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
                }, 600);
            } else {
                log += `<br><span style="color:var(--accent-red)">P${playerNum} FALLS!</span>`;
                const fatalMove = playerNum === 1 ? p2MoveKey : p1MoveKey;
                const fatalCost = playerNum === 1 ? m2.cost : m1.cost;
                
                targetEl.classList.add('hit-anim', `fatal-${fatalMove}`);
                attackerEl.classList.add('anim-struggle-victory');
                
                if (fatalCost >= 4) this.triggerCinematicFinish();
                
                setTimeout(() => {
                    attackerEl.classList.remove('anim-struggle-victory');
                    this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
                }, 1000);
            }
        };
    },
	
	spawnFeedbackParticle: function(isSuccess, isGold) {
        const qteEl = document.getElementById('qte-overlay');
        const pivotEl = document.getElementById('qte-needle-pivot');
        
        // Safety check to ensure the UI actually exists before trying to attach things to it
        if (!qteEl || !pivotEl) return; 

        const particle = document.createElement('div');
        
        if (isGold) {
            particle.className = `qte-floating-icon qte-hit-gold`;
            particle.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" stroke="#ffd700" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        } else {
            particle.className = `qte-floating-icon ${isSuccess ? 'qte-hit' : 'qte-miss'}`;
            particle.innerHTML = isSuccess 
                ? `<svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : `<svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        }
        
        const offset = (Math.random() - 0.5) * 60; 
        particle.style.left = `calc(50% + ${offset}px)`;
        
        qteEl.appendChild(particle);
        setTimeout(() => particle.remove(), 800);
        
        const needleInner = pivotEl.querySelector('.qte-needle');
        if (needleInner) {
            needleInner.style.backgroundColor = isGold ? '#ffd700' : (isSuccess ? 'var(--pastel-green)' : 'var(--pastel-red)');
            setTimeout(() => { if(needleInner) needleInner.style.backgroundColor = '#fdfffc'; }, 150);
        }
    },
	
	triggerRecoilZap: function(playerNum) {
		const avatarId = `p${playerNum}-rikishi`;
		const avatarEl = document.getElementById(avatarId);
		if (!avatarEl) return;

		const zapEl = document.createElement('div');
		zapEl.className = 'recoil-zap-fx';
		
		// --- DIRECTIONAL MATH ---
		// P1 faces Right. The front of their belly is at 80% width. Recoil pushes them Left (-1).
		// P2 faces Left. The front of their belly is at 20% width. Recoil pushes them Right (+1).
		const isP1 = playerNum === 1;
		zapEl.style.setProperty('--front-x', isP1 ? '80%' : '20%');
		zapEl.style.setProperty('--recoil-dir', isP1 ? '-1' : '1');

		// A jagged, sharp kinetic burst SVG
		zapEl.innerHTML = `
			<svg viewBox="0 0 100 100" style="width: 80px; height: 80px; filter: drop-shadow(0 0 8px #f1c40f);">
				<path d="M 10 50 L 45 30 L 40 45 L 90 40 L 55 60 L 60 45 Z" fill="#f1c40f" stroke="#fff" stroke-width="2" stroke-linejoin="round" />
			</svg>
		`;

		avatarEl.appendChild(zapEl);

		// Cleanup
		setTimeout(() => {
			if (zapEl.parentNode) zapEl.remove();
		}, 400);
	},
	
	// --- NEW FUNCTION: CPU BALANCE CHECK SIMULATION ---
    startCPUBalanceCheck: function(playerNum, d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log) {
        this.qteActive = true;
        this.triggerExcitement(6000);

        if (!document.getElementById('qte-overlay')) {
            const qteHTML = `
                <div id="qte-overlay" class="qte-overlay">
                    <div class="qte-instruction">RECOVER!</div>
                    <div id="qte-dial-container" class="qte-dial-container">
                        <div id="qte-needle-pivot" class="qte-needle-pivot">
                            <div class="qte-needle"></div>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('game-board').insertAdjacentHTML('beforeend', qteHTML);
        }
		
		if (this.music) this.music.setConcentrationMode(true, 0.6);

        const incomingCost = playerNum === 1 ? (m2.cost || 0) : (m1.cost || 0);
        const survivedCount = playerNum === 1 ? (this.matchStats.p1BalanceChecksSurvived || 0) : (this.matchStats.p2BalanceChecksSurvived || 0);

        const tickDuration = Math.max(250, 600 - (incomingCost * 80)); 
        let successThreshold = Math.min(0.95, 0.80 + (survivedCount * 0.06)); 
        
        // --- NEW: DETERMINE IF THE CPU HAS THE GOLD UPGRADE ---
        // 1. Check if the player's profile has the achievement
        const playerHasOzekiSlayer = !!(this.achievements && this.achievements['ozeki_slayer']);
        
        // 2. The CPU gets the upgrade if they are the Ozeki, OR if the player has the achievement and it's a Makuuchi-tier fight
        const hasGoldUpgrade = this.mode === 'cpu' && (
            (this.currentOpponentName && this.currentOpponentName.includes('Ozeki')) || 
            (playerHasOzekiSlayer && this.cpuDiff === 5)
        );
        
        let goldThreshold = successThreshold + ((1 - successThreshold) * 0.6);
        const zoneWidthPercent = (1 - successThreshold) * 100;

        const qteEl = document.getElementById('qte-overlay');
        const pivotEl = document.getElementById('qte-needle-pivot');
        
        qteEl.className = `qte-overlay show ${playerNum === 1 ? 'left-side' : 'right-side'}`;

        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        const arcTotalDegrees = 120;
        
        const bgLength = (arcTotalDegrees / 360) * circumference;
        const targetDegrees = (zoneWidthPercent / 100) * arcTotalDegrees;
        const targetLength = (targetDegrees / 360) * circumference;
        const targetStartDegree = -150 + ((arcTotalDegrees - targetDegrees) / 2);

        const borderDegrees = targetDegrees + 6; 
        const borderLength = (borderDegrees / 360) * circumference;
        const borderStartDegree = -150 + ((arcTotalDegrees - borderDegrees) / 2);

        let existingSvg = document.getElementById('qte-svg-dial');
        if (existingSvg) existingSvg.remove();

        // --- NEW: DRAW GOLDEN SVG BAND FOR CPU ---
        let goldSVG = '';
        if (hasGoldUpgrade) {
            const goldWidthPercent = (1 - goldThreshold) * 100;
            const goldDegrees = (goldWidthPercent / 100) * arcTotalDegrees;
            const goldLength = (goldDegrees / 360) * circumference;
            const goldStartDegree = -150 + ((arcTotalDegrees - goldDegrees) / 2);
            goldSVG = `<circle id="qte-gold-zone" cx="50" cy="50" r="40" fill="none" stroke="#ffd700" stroke-width="12" stroke-dasharray="${goldLength} ${circumference}" transform="rotate(${goldStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />`;
        }

        const svgHTML = `
            <svg id="qte-svg-dial" class="qte-svg-dial" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="12" stroke-dasharray="${bgLength} ${circumference}" transform="rotate(-150 50 50)" stroke-linecap="round"/>
                <circle id="qte-border-zone" cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 255, 255, 0.9)" stroke-width="14" stroke-dasharray="${borderLength} ${circumference}" transform="rotate(${borderStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />
                <circle id="qte-green-zone" cx="50" cy="50" r="40" fill="none" stroke="var(--pastel-green)" stroke-width="12" stroke-dasharray="${targetLength} ${circumference}" transform="rotate(${targetStartDegree} 50 50)" style="transition: stroke-dasharray 0.3s ease, transform 0.3s ease;" />
                ${goldSVG}
            </svg>
        `;
        document.getElementById('qte-dial-container').insertAdjacentHTML('afterbegin', svgHTML);

        const maxTicks = Math.floor(Math.random() * 4) + 3;
        let accumulatedScore = 0;
        let goldHits = 0; 
        const scoreToPass = maxTicks * successThreshold;

        let cpuSkill = 0.2; 
        let waitTicks = 5; // Default baseline grace period
        
        // --- NEW: CPU DELAY & SKILL LOGIC ---
        if (this.mode === 'cpu' && this.cpuDiff !== undefined) {
            const skillMap = { 'tutorial': 0.10, 0: 0.25, 1: 0.40, 2: 0.60, 3: 0.75, 4: 0.85, 5: 0.95 };
            cpuSkill = skillMap[this.cpuDiff] || 0.20;

            // Determine how many sweeps the CPU "watches" before acting
            const waitMap = {
                'tutorial': () => Math.floor(Math.random() * 4) + 5, // 5 to 8 ticks
                0: () => Math.floor(Math.random() * 4) + 5,          // 5 to 8 ticks
                1: () => Math.floor(Math.random() * 3) + 4,          // 4 to 6 ticks
                2: () => Math.floor(Math.random() * 3) + 3,          // 3 to 5 ticks
                3: () => Math.floor(Math.random() * 2) + 2,          // 2 to 3 ticks
                4: () => Math.floor(Math.random() * 2) + 1,          // 1 to 2 ticks
                5: () => Math.floor(Math.random() * 2)               // 0 to 1 ticks
            };
            waitTicks = (waitMap[this.cpuDiff] || waitMap[0])();
        }

        const scheduledTaps = [];
        for (let i = 0; i < maxTicks; i++) {
            // Shift the start index by waitTicks so the CPU idles for the first few sweeps
            const sweepIndex = i + waitTicks;
            const perfectCenterTime = (sweepIndex + 0.5) * tickDuration;
            const maxError = tickDuration * 0.5 * (1 - cpuSkill);
            const error = (Math.random() * maxError * 2) - maxError;
            scheduledTaps.push(perfectCenterTime + error);
        }

        let startTime = performance.now();
        let lastTickIndex = 0;
        let currentTick = 0;
        let isEnding = false; 

        const animateNeedle = (currentTime) => {
            if (!this.qteActive || isEnding) return; 
            const elapsed = currentTime - startTime;
            const progress = (elapsed % (tickDuration * 2)) / tickDuration;
            const position = progress <= 1 ? progress : 2 - progress;
            
            const currentDeg = -60 + (position * 120);
            pivotEl.style.transform = `rotate(${currentDeg}deg)`;
            
            const currentTickIndex = Math.floor(elapsed / tickDuration);
            if (currentTickIndex > lastTickIndex) {
                if (typeof sound !== 'undefined') sound.play('click');
                lastTickIndex = currentTickIndex;
            }

            if (currentTick < maxTicks && elapsed >= scheduledTaps[currentTick]) {
                const distFromCenter = Math.abs(position - 0.5);
                const score = Math.max(0, 1 - (distFromCenter * 2));
                accumulatedScore += score;
                
                const isSuccess = score > successThreshold;
                const isGold = hasGoldUpgrade && score >= goldThreshold;
                if (isGold) goldHits++;
                
                // --- THE FIX: Call the shared method! ---
                this.spawnFeedbackParticle(isSuccess, isGold);
                
                if (isGold) {
                    if (typeof sound !== 'undefined') sound.play('qte_gold');
                } else if (isSuccess) {
                    if (typeof sound !== 'undefined') sound.play('qte_success');
                } else {
                    if (typeof sound !== 'undefined') sound.play('qte_fail');
                }

                currentTick++;
                // ... (rest of the logic remains the same)
                const remainingTicks = maxTicks - currentTick;
                const maxPossibleScore = accumulatedScore + remainingTicks;

                if (maxPossibleScore < scoreToPass || currentTick >= maxTicks) {
                    isEnding = true;
                    endQTE();
                    return; 
                }

                if (remainingTicks > 0) {
                    const neededScore = scoreToPass - accumulatedScore;
                    const requiredAverage = neededScore / remainingTicks;

                    if (requiredAverage > successThreshold && requiredAverage <= 1.0) {
                        successThreshold = requiredAverage;
                        
                        const newZoneWidth = (1 - successThreshold) * 100;
                        const newTargetDeg = (newZoneWidth / 100) * arcTotalDegrees;
                        const newTargetLen = (newTargetDeg / 360) * circumference;
                        const newStartDeg = -150 + ((arcTotalDegrees - newTargetDeg) / 2);

                        const newBorderDeg = newTargetDeg + 6;
                        const newBorderLen = (newBorderDeg / 360) * circumference;
                        const newBorderStart = -150 + ((arcTotalDegrees - newBorderDeg) / 2);

                        const greenZone = document.getElementById('qte-green-zone');
                        const borderZone = document.getElementById('qte-border-zone');

                        if (greenZone && borderZone) {
                            greenZone.setAttribute('stroke-dasharray', `${newTargetLen} ${circumference}`);
                            greenZone.setAttribute('transform', `rotate(${newStartDeg} 50 50)`);
                            borderZone.setAttribute('stroke-dasharray', `${newBorderLen} ${circumference}`);
                            borderZone.setAttribute('transform', `rotate(${newBorderStart} 50 50)`);
                        }

                        if (hasGoldUpgrade) {
                            goldThreshold = successThreshold + ((1 - successThreshold) * 0.6);
                            const newGoldWidthPercent = (1 - goldThreshold) * 100;
                            const newGoldDegrees = (newGoldWidthPercent / 100) * arcTotalDegrees;
                            const newGoldLength = (newGoldDegrees / 360) * circumference;
                            const newGoldStart = -150 + ((arcTotalDegrees - newGoldDegrees) / 2);
                            const goldZone = document.getElementById('qte-gold-zone');
                            if (goldZone) {
                                goldZone.setAttribute('stroke-dasharray', `${newGoldLength} ${circumference}`);
                                goldZone.setAttribute('transform', `rotate(${newGoldStart} 50 50)`);
                            }
                        }
                    }
                }
            }

            requestAnimationFrame(animateNeedle);
        };
        
        requestAnimationFrame(animateNeedle);

        const endQTE = () => {
            if (!this.qteActive) return; 
            this.qteActive = false;
			
			if (this.music) this.music.setConcentrationMode(false);
			
            qteEl.classList.remove('show');
            
            const passed = accumulatedScore >= scoreToPass;
            const targetEl = playerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
            
            const attackerNum = playerNum === 1 ? 2 : 1;
            const attackerEl = attackerNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
            
            targetEl.classList.remove('anim-teeter');
            attackerEl.classList.remove('anim-struggle-push'); 
            
            if (passed) {
                if (playerNum === 1) this.matchStats.p1BalanceChecksSurvived = (this.matchStats.p1BalanceChecksSurvived || 0) + 1;
                if (playerNum === 2) this.matchStats.p2BalanceChecksSurvived = (this.matchStats.p2BalanceChecksSurvived || 0) + 1;

                if (hasGoldUpgrade && goldHits > 0) {
					// THE FIX: Updated text for CPU player!
					log += `<br><span style="color:#ffd700; text-shadow: 0 0 5px rgba(255,215,0,0.5);">CPU HASSOTOBI! (+${goldHits} BONUS HP)</span>`;
				} else {
					log += `<br><span style="color:var(--gold)">CPU CLINGS TO THE EDGE!</span>`;
				}
                
                if (playerNum === 1) d1 = this.p1.hp - (1 + goldHits); 
                if (playerNum === 2) d2 = this.p2.hp - (1 + goldHits);
                
                targetEl.classList.add('anim-recover');
                attackerEl.classList.add('anim-struggle-rebound');
                
                setTimeout(() => {
                    targetEl.classList.remove('anim-recover');
                    attackerEl.classList.remove('anim-struggle-rebound'); 
                    this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
                }, 600);
            } else {
                log += `<br><span style="color:var(--accent-red)">CPU FALLS!</span>`;
                const fatalMove = playerNum === 1 ? p2MoveKey : p1MoveKey;
                const fatalCost = playerNum === 1 ? m2.cost : m1.cost;
                
                targetEl.classList.add('hit-anim', `fatal-${fatalMove}`);
                attackerEl.classList.add('anim-struggle-victory');
                
                if (fatalCost >= 4) this.triggerCinematicFinish();
                
                setTimeout(() => {
                    attackerEl.classList.remove('anim-struggle-victory'); 
                    this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
                }, 1000);
            }
        };
    },

    receiveOpponentQTE: function(passed, goldHits = 0) {
        // PATCH 1: Updated variable name to match startBalanceCheck
        if (!this.pendingQTEParams) return; 
        
        // PATCH 2: Removed oppNum from destructuring (it wasn't in the payload)
        let { d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log } = this.pendingQTEParams;
        
        // Find who is who
        const amHost = net.side === 'host';
        const oppNum = amHost ? 2 : 1;
        const myNum = amHost ? 1 : 2;

        const targetEl = oppNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');
        const attackerEl = myNum === 1 ? document.getElementById('p1-rikishi') : document.getElementById('p2-rikishi');

        // PATCH 3: Clean up BOTH players' waiting animations
        targetEl.classList.remove('anim-teeter');
        attackerEl.classList.remove('anim-struggle-push'); 
        
        if (passed) {
            if (goldHits > 0) {
                log += `<br><span style="color:#ffd700; text-shadow: 0 0 5px rgba(255,215,0,0.5);">OPPONENT OZEKI'S RESOLVE! (+${goldHits} BONUS HP)</span>`;
            } else {
                log += `<br><span style="color:var(--gold)">OPPONENT PASSED BALANCE CHECK!</span>`;
            }
            
            if (oppNum === 1) d1 = this.p1.hp - (1 + goldHits); 
            if (oppNum === 2) d2 = this.p2.hp - (1 + goldHits);
            
            targetEl.classList.add('anim-recover');
            attackerEl.classList.add('anim-struggle-rebound'); // Show attacker bouncing off
            
            if (typeof sound !== 'undefined') sound.play('qte_success');

            // PATCH 4: Wait for the recovery animation to finish before going to next round
            setTimeout(() => {
                targetEl.classList.remove('anim-recover');
                attackerEl.classList.remove('anim-struggle-rebound');
                this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
            }, 600);

        } else {
            log += `<br><span style="color:var(--accent-red)">OPPONENT FALLS!</span>`;
            
            const fatalMove = oppNum === 1 ? p2MoveKey : p1MoveKey;
            const fatalCost = oppNum === 1 ? m2.cost : m1.cost;
            
            targetEl.classList.add('hit-anim', `fatal-${fatalMove}`);
            attackerEl.classList.add('anim-struggle-victory'); // Show attacker posing
            
            if (typeof sound !== 'undefined') sound.play('qte_fail');
            if (fatalCost >= 4) this.triggerCinematicFinish();

            // PATCH 4: Wait for the fatal fall animation to play out
            setTimeout(() => {
                attackerEl.classList.remove('anim-struggle-victory');
                this.finalizeTurnResolution(d1, d2, p1Perfect, p2Perfect, p1Atk, p2Atk, m1, m2, p1MoveKey, p2MoveKey, log);
            }, 1000);
        }

        this.pendingQTEParams = null; // Clear the lock
    },
	
	openPracticeMinigame: function() {
        this.hideOverlays();
        this.practiceActive = true;
        document.getElementById('practice-environment').classList.remove('hidden');
        
        // --- AUDIO: Transition to Pure Drums ---
        if (this.music) this.music.setPracticeMode(true);

        // ... rest of your initialization code ...
        const container = document.getElementById('practice-rikishi-container');
        container.innerHTML = '';
        
        // Re-use the existing avatar structure
        const rikishiClone = document.getElementById('p1-rikishi').cloneNode(true);
        rikishiClone.id = 'practice-avatar';
        rikishiClone.style.transform = 'scale(1.2)'; 
        container.appendChild(rikishiClone);

        // Reset Stats
        this.practiceStats = {
            round: 0,
            maxRounds: Math.floor(Math.random() * 5) + 6, // 6 to 10 rounds
            passes: 0,
            totalScorePercent: 0,
            history: []
        };

        // --- NEW: INITIALIZE MOCK DECK ---
        // Build the draw pile using the player's active campaign deck
        this.initDeckState(1);

        this.startPracticeCountdown();
    },

    triggerPracticeGyoji: function(text, duration = 1500) {
        const shoutEl = document.getElementById('practice-gyoji-shout');
        shoutEl.innerHTML = text;
        shoutEl.style.opacity = '1';
        
        if (typeof sound !== 'undefined') sound.play('click'); // Or a specific shout sound

        if (this.practiceTimer) clearTimeout(this.practiceTimer);
        this.practiceTimer = setTimeout(() => {
            shoutEl.style.opacity = '0';
        }, duration);
    },

    startPracticeCountdown: function() {
        let count = 3;
        const countdownLoop = () => {
            if (count > 0) {
                const kanjiNum = count === 3 ? "三" : (count === 2 ? "二" : "一");
                this.triggerPracticeGyoji(`${kanjiNum} ${count}...`, 800);
                count--;
                setTimeout(countdownLoop, 1000);
            } else {
                this.triggerPracticeGyoji("集中!<br><span style='font-size:0.5em'>Shūchū! (Focus)</span>", 1500);
                setTimeout(() => this.runPracticeRound(), 2000);
            }
        };
        countdownLoop();
    },

    runPracticeRound: function() {
        this.practiceStats.round++;
        
        // 1. Calculate a soft "Base" difficulty that slowly creeps up as rounds progress
        const baseSpeed = 600 - (this.practiceStats.round * 25);
        const baseThreshold = 0.70 + (this.practiceStats.round * 0.02);

        // 2. Inject the Chaos (Random Variance)
        // Speed can randomly be up to 100ms faster, or 150ms slower than the base
        const speedChaos = (Math.random() * 250) - 100; 
        
        // Target width can randomly shrink by up to 10%, or grow by up to 8%
        const widthChaos = (Math.random() * 0.18) - 0.08; 

        // 3. Apply limits so it never becomes literally impossible or completely broken
        const tickDuration = Math.max(200, baseSpeed + speedChaos); 
        const successThreshold = Math.min(0.96, Math.max(0.60, baseThreshold + widthChaos));

        // Start the QTE with the randomized variables
        this.triggerPracticeQTE(tickDuration, successThreshold);
    },

    triggerPracticeQTE: function(tickDuration, successThreshold) {
        this.qteActive = true; 
        
        // Make the avatar stumble immediately!
        const avatar = document.getElementById('practice-avatar');
        if (avatar) avatar.classList.add('anim-teeter');

        // --- NEW: THE MOCK HAND CYCLE ---
        let hasGoldUpgrade = false;
        let upgradeCardKey = null;
        let upgradeStackCount = 0;

        // Ensure the deck was built properly
        if (this.p1 && this.p1.hand && this.p1.drawPile) {
            
            // 1. Discard the previous hand
            this.p1.discardPile.push(...this.p1.hand);
            this.p1.hand = [];
            
            // 2. Draw a fresh 5 cards for this specific stumble
            this.drawCards(1, 5);

            // 3. Check the new hand for balance-saving legendaries
            // (You can easily add more comma-separated keys to this array later!)
            const recoveryCards = ['hassotobi'];

            this.p1.hand.forEach(card => {
                if (recoveryCards.includes(card.type)) {
                    hasGoldUpgrade = true;
                    upgradeCardKey = card.type;
                    upgradeStackCount++; // In case they drew two of them!
                }
            });
        }

        // --- OVERLAY SETUP ---
        let qteEl = document.getElementById('qte-overlay');      
        if (!qteEl) {
            const qteHTML = `
                <div id="qte-overlay" class="qte-overlay">
                    <div class="qte-instruction">FOCUS!</div>
                    <div id="qte-dial-container" class="qte-dial-container">
                        <div id="qte-needle-pivot" class="qte-needle-pivot"><div class="qte-needle"></div></div>
                    </div>
                </div>
            `;
            document.getElementById('practice-environment').insertAdjacentHTML('beforeend', qteHTML);
            qteEl = document.getElementById('qte-overlay');
        } else {
            document.getElementById('practice-environment').appendChild(qteEl);
        }

        qteEl.style.zIndex = '200';
        const pivotEl = document.getElementById('qte-needle-pivot');
        
        qteEl.className = `qte-overlay show`; 
        qteEl.style.left = '50%';
        qteEl.style.top = '30%'; 
        qteEl.style.transform = 'translate(-50%, -50%)';

        // --- MATH FOR SVG ---
        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        const arcTotalDegrees = 120;
        const bgLength = (arcTotalDegrees / 360) * circumference;
        
        const zoneWidthPercent = (1 - successThreshold) * 100;
        const targetDegrees = (zoneWidthPercent / 100) * arcTotalDegrees;
        const targetLength = (targetDegrees / 360) * circumference;
        const targetStartDegree = -150 + ((arcTotalDegrees - targetDegrees) / 2);

        // --- NEW: CONDITIONAL GOLD MATH ---
        let goldThreshold = 2.0; // Mathematically impossible default (max score is 1.0)
        let goldLength = 0;
        let goldStartDegree = 0;

        if (hasGoldUpgrade) {
            // Calculate the generous gold zone
            goldThreshold = successThreshold + ((1 - successThreshold) * 0.8);
            const goldWidthPercent = (1 - goldThreshold) * 100;
            const goldDegrees = (goldWidthPercent / 100) * arcTotalDegrees;
            goldLength = (goldDegrees / 360) * circumference;
            goldStartDegree = -150 + ((arcTotalDegrees - goldDegrees) / 2);

            // Pop the visual on the side of the screen to notify the player!
            // We pass 'true' at the end to suppress the text-log entry.
            this.activateCardEffect(1, upgradeCardKey, 0, upgradeStackCount, true);
        }

        let existingSvg = document.getElementById('qte-svg-dial');
        if (existingSvg) existingSvg.remove();

        const svgHTML = `
            <svg id="qte-svg-dial" class="qte-svg-dial" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="12" stroke-dasharray="${bgLength} ${circumference}" transform="rotate(-150 50 50)" stroke-linecap="round"/>
                <circle id="qte-green-zone" cx="50" cy="50" r="40" fill="none" stroke="var(--pastel-green)" stroke-width="12" stroke-dasharray="${targetLength} ${circumference}" transform="rotate(${targetStartDegree} 50 50)" />
                <circle id="qte-gold-zone" cx="50" cy="50" r="40" fill="none" stroke="#ffd700" stroke-width="12" stroke-dasharray="${goldLength} ${circumference}" transform="rotate(${goldStartDegree} 50 50)" />
            </svg>
        `;
        document.getElementById('qte-dial-container').insertAdjacentHTML('afterbegin', svgHTML);

        const maxTicks = 4;
        let accumulatedScore = 0;
        let currentTick = 0;
        const scoreToPass = maxTicks * successThreshold;
        
        let startTime = performance.now();
        let isEnding = false;
        let lastTickIndex = 0;

        const processTap = () => {
            const elapsed = performance.now() - startTime;
            const progress = (elapsed % (tickDuration * 2)) / tickDuration;
            const position = progress <= 1 ? progress : 2 - progress;
            
            const distFromCenter = Math.abs(position - 0.5);
            const score = Math.max(0, 1 - (distFromCenter * 2));
            const isSuccess = score > successThreshold;
            
            // If they don't have the card, goldThreshold is 2.0, making this safely impossible
            const isGold = score >= goldThreshold; 

            accumulatedScore += score;
            currentTick++;

            this.spawnFeedbackParticle(isSuccess, isGold);
            
            if (typeof sound !== 'undefined') sound.play(isGold ? 'qte_gold' : (isSuccess ? 'qte_success' : 'qte_fail'));

            const remainingTicks = maxTicks - currentTick;
            const maxPossibleScore = accumulatedScore + remainingTicks;

            if (maxPossibleScore < scoreToPass || currentTick >= maxTicks) {
                isEnding = true;
                
                const passed = accumulatedScore >= scoreToPass;
                const perfection = Math.min(100, (accumulatedScore / maxTicks) * 100);
                
                this.practiceStats.history.push({ passed, perfection, isGold });
                if (passed) this.practiceStats.passes++;
                this.practiceStats.totalScorePercent += perfection;

                endPracticeQTE(passed);
            }
        };

        const handleTap = (e) => {
            if (e.type === 'keydown' && e.code !== 'Space') return;
            if (!this.qteActive || isEnding) return;
            processTap();
        };

        window.addEventListener('keydown', handleTap);
        document.getElementById('practice-environment').addEventListener('pointerdown', handleTap);

        const animateNeedle = (currentTime) => {
            if (!this.qteActive || isEnding) return; 
            const elapsed = currentTime - startTime;
            const progress = (elapsed % (tickDuration * 2)) / tickDuration;
            const position = progress <= 1 ? progress : 2 - progress; 
            
            const currentDeg = -60 + (position * 120);
            pivotEl.style.transform = `rotate(${currentDeg}deg)`;
            
            const currentTickIndex = Math.floor(elapsed / tickDuration);
            if (currentTickIndex > lastTickIndex) {
                if (typeof sound !== 'undefined') sound.play('click');
                lastTickIndex = currentTickIndex;
            }
            
            requestAnimationFrame(animateNeedle);
        };
        requestAnimationFrame(animateNeedle);

        const endPracticeQTE = (passed) => {
            this.qteActive = false;
            window.removeEventListener('keydown', handleTap);
            document.getElementById('practice-environment').removeEventListener('pointerdown', handleTap);
            qteEl.classList.remove('show');
            
            const avatar = document.getElementById('practice-avatar');
            avatar.classList.remove('anim-teeter');

            if (passed) {
                avatar.classList.add('anim-recover');
                this.triggerPracticeGyoji("よくやった!<br><span style='font-size:0.5em'>Yoku yatta! (Well done)</span>", 1500);
                setTimeout(() => avatar.classList.remove('anim-recover'), 600);
            } else {
                avatar.classList.add('hit-anim');
                this.triggerPracticeGyoji("あきらめないで!<br><span style='font-size:0.5em'>Akiramenaide! (Don't give up)</span>", 1500);
                setTimeout(() => avatar.classList.remove('hit-anim'), 600);
            }

            if (this.practiceStats.round < this.practiceStats.maxRounds) {
                setTimeout(() => this.runPracticeRound(), 2000);
            } else {
                setTimeout(() => this.showPracticeResults(), 2000);
            }
        };
    },

    showPracticeResults: function() {
        this.practiceActive = false;
        document.getElementById('practice-environment').classList.add('hidden');
        document.getElementById('practice-results-screen').classList.remove('hidden');

        const p = this.practiceStats;
        const avgPerfection = p.maxRounds > 0 ? (p.totalScorePercent / p.maxRounds).toFixed(1) : 0;

        document.getElementById('practice-passes-text').innerText = `${p.passes}/${p.maxRounds}`;
        document.getElementById('practice-percent-text').innerText = `${avgPerfection}%`;

        // Generate the visual history tracker
        const iconContainer = document.getElementById('practice-history-icons');
        iconContainer.innerHTML = '';
        
        p.history.forEach(result => {
            let color = result.passed ? 'var(--pastel-green)' : 'var(--pastel-red)';
            if (result.isGold) color = '#ffd700';

            const icon = result.passed 
                ? `<svg viewBox="0 0 24 24" width="28" height="28" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : `<svg viewBox="0 0 24 24" width="28" height="28" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            
            iconContainer.innerHTML += `<div style="background: rgba(0,0,0,0.1); padding: 5px; border-radius: 5px;">${icon}</div>`;
        });

        // --- NEW LOOT REWARD SYSTEM ---
        const rewardEl = document.getElementById('practice-reward-text');

        if (!this.career.practicedThisBasho) {
            this.career.practicedThisBasho = true;
            
            const passRatio = p.maxRounds > 0 ? p.passes / p.maxRounds : 0;
            let numCards = 0;
            
            // Determine quantity
            if (passRatio >= 0.5) numCards = 1;
            if (passRatio >= 0.8) numCards = 2;
            if (passRatio === 1.0) numCards = 3;

            let earnedLoot = [];
            
            if (numCards > 0) {
                // Build pools
                const pools = { common: [], rare: [], epic: [], legendary: [] };
                for (let key in this.RESOURCE_CARDS) {
                    let r = this.RESOURCE_CARDS[key].rarity || 'common';
                    if (pools[r]) pools[r].push(key);
                }

                // Roll for each card
                for (let i = 0; i < numCards; i++) {
                    let roll = Math.random();
                    let rarity = 'common';
                    
                    // Perfection drives rarity. A 95% perfection score acts as a 0.95 multiplier against the thresholds
                    const perfBonus = avgPerfection / 100;

                    // Hard to get legendary (Needs > 90% perfection, and then only a 5% chance)
                    if (perfBonus >= 0.90 && roll < (0.05 * perfBonus)) rarity = 'legendary';
                    else if (perfBonus >= 0.80 && roll < (0.20 * perfBonus)) rarity = 'epic';
                    else if (perfBonus >= 0.60 && roll < (0.45 * perfBonus)) rarity = 'rare';

                    // Safe Fallbacks
                    if (rarity === 'legendary' && pools.legendary.length === 0) rarity = 'epic';
                    if (rarity === 'epic' && pools.epic.length === 0) rarity = 'rare';
                    if (rarity === 'rare' && pools.rare.length === 0) rarity = 'common';

                    let pool = pools[rarity];
                    if (pool && pool.length > 0) {
                        earnedLoot.push(pool[Math.floor(Math.random() * pool.length)]);
                    }
                }

                // Grant the loot to the collection
                earnedLoot.forEach(cardKey => {
                    this.career.cardCollection[cardKey] = (this.career.cardCollection[cardKey] || 0) + 1;
                });
            }

            // Save the loot to a temporary variable so we can trigger the UI when the screen closes
            this.practiceEarnedLoot = earnedLoot;

            // Update the UI Text for the FIRST run
            if (rewardEl) {
                if (earnedLoot.length > 0) {
                    rewardEl.innerHTML = `Unbreakable Focus! Yielded <br><span style="color: var(--pastel-green); font-size: 1.8rem; font-family: var(--font-title);">${earnedLoot.length}</span><br> Resource Card(s)!`;
                } else {
                    rewardEl.innerHTML = `<span style="color: var(--pastel-red); font-style: italic;">Your focus wavered.<br>No wisdom was gained today.</span>`;
                }
            }
        } else {
            // --- THE FIX: Explicitly handle subsequent practice runs! ---
            if (rewardEl) {
                rewardEl.innerHTML = `<span style="color: #666; font-style: italic;">You have already meditated this season.<br>Rest your mind for the bouts ahead.</span>`;
            }
            // Ensure no ghost-loot triggers when closing the menu
            this.practiceEarnedLoot = null; 
        }
    
        this.saveStats();
        this.saveCareer();
        
        if (typeof sound !== 'undefined') sound.play('achievement');
    },

    closePracticeMinigame: function() {
        document.getElementById('practice-results-screen').classList.add('hidden');
        
        // --- AUDIO: Restore Ambience ---
        if (this.music) this.music.setPracticeMode(false);

        this.qteActive = false;
        this.practiceActive = false;
        
        // Reset the environment position we messed with
        const qteEl = document.getElementById('qte-overlay');
        if (qteEl) {
            qteEl.style.left = '';
            qteEl.style.top = ''; 
            qteEl.style.transform = '';
            qteEl.style.zIndex = '';
            qteEl.classList.remove('show');
            
            // Give the overlay back to the main game board
            document.getElementById('game-board').appendChild(qteEl);
        }

        // Return to the campaign screen first
        this.openCampaign();

        // --- NEW: Trigger Loot Reveal OVER the Campaign Screen ---
        if (this.practiceEarnedLoot !== undefined && this.practiceEarnedLoot !== null) {
            if (this.practiceEarnedLoot.length > 0) {
                // They earned cards! Show the reward.
                this.renderLootUI(this.practiceEarnedLoot, "TRAINING REWARD 稽古の成果");
            } else {
                // They passed 0 checks. Show the brutal Ash card!
                this.renderLootUI([], "LOST FOCUS 灰");
            }
            // Clear the temporary variable so it doesn't trigger again later
            this.practiceEarnedLoot = null; 
        }
    },
	
	triggerCinematicFinish: function() {
        // Target your main wrapper
        const board = document.getElementById('game-board');
        
        // 1. Fire the Zoom, Vignette, and Screen Tear
        board.classList.add('cinematic-fatal', 'screen-tear');
        
        // 2. Trigger HIT-STOP (Freeze everything at the moment of impact)
        document.body.classList.add('hit-stop');
        
        // 3. Unfreeze after 250ms so the fatal animations play out in "Slow-Mo"
        setTimeout(() => {
            document.body.classList.remove('hit-stop');
        }, 250); 

        // 4. Clean up the screen tear class so it can be reused in future matches
        setTimeout(() => {
            board.classList.remove('screen-tear');
        }, 500);
    },
	
	toggleSpeed: function() {
        // Toggle State
        this.speedMode = (this.speedMode === 1) ? 2 : 1;
        
        // Set Multiplier (0.35 means animations run at ~3x speed)
        this.timeMult = (this.speedMode === 2) ? 0.35 : .9;
		
		document.body.classList.toggle('fast-mode', this.speedMode === 2);

        // Visual Feedback (Log)
        const icon = (this.speedMode === 2) ? "⏩" : "▶️";
        this.log(`${icon} GAME SPEED: ${this.speedMode === 2 ? "FAST" : "NORMAL"}`);

        // Optional: Update a UI button if you have one
        const btn = document.getElementById('btn-speed');
        if (btn) {
            btn.classList.toggle('active', this.speedMode === 2);
            btn.innerText = (this.speedMode === 2) ? ">>" : ">";
        }
    },

	// HELPER FUNCTION: To keep animateCombat clean
	performImpactEffects: function(move) {
		const isHigh = move.type.includes('high');
		const flashEl = document.getElementById('hit-flash');
		
		sound.play(isHigh ? 'hit_high' : 'hit_low');

		// --- TRIGGER FLASH ---
		if (flashEl) {
			// Reset classes
			flashEl.classList.remove('flash-active', 'flash-super');
			void flashEl.offsetWidth; // Force reflow to restart animation

			if (move.cost >= 4) {
				flashEl.classList.add('flash-super'); // Violent Red
			} else {
				flashEl.classList.add('flash-active'); // Standard White
			}
		}

		// --- SCREEN SHAKE & HIT STOP ---
		if (move.cost >= 4) {
			this.hitStop(250); // Massive freeze
			this.shakeScreen('heavy');
			this.triggerExcitement(8000);
		} else if (move.cost == 3) {
			this.hitStop(150);
			this.shakeScreen('med');
			this.triggerExcitement(4000);
		}
	},

	resetAvatars: function(forceReset = false) {
		const board = document.getElementById('game-board');
		
		// Only clear the cinematic lighting if we are actually starting a new match
		if (forceReset) {
			board.classList.remove('cinematic-fatal', 'screen-tear');
			document.body.classList.remove('hit-stop');
		}

		const els = board.querySelectorAll('.rikishi');
		els.forEach(e => {
			const isP1 = (e.id === 'p1-rikishi');
			
			// Get the health of the current avatar being evaluated
			const hp = isP1 ? this.p1.hp : this.p2.hp;

			// THE GATEWAY: Only reset this avatar if they are alive, OR if we are forcing a restart
			if (hp > 0 || forceReset) {
				const currentHairClass = Array.from(e.classList).find(c => c.startsWith('hair-'));
				// This line wipes ALL classes (including our fatal animations), so we protect it
				e.className = 'rikishi'; 
				e.classList.add(isP1 ? 'p1' : 'p2');
				
				if (currentHairClass) {
					e.classList.add(currentHairClass);
				}
				
				let cosmeticData = { mawashi: 'maw_default', skin: 'skin_default' };
				
				if (this.mode === 'online') {
					const amHost = net.side === 'host';
					if ((amHost && isP1) || (!amHost && !isP1)) {
						cosmeticData = this.playerCosmetics;
					} else {
						if (net.opponentCosmetics) cosmeticData = net.opponentCosmetics;
					}
				} 
				else {
					if (isP1) {
						cosmeticData = this.playerCosmetics;
					} else if (this.mode === 'cpu') {
						cosmeticData = this.currentOpponentCosmetics || { mawashi: 'maw_default', skin: 'skin_default' };
					}
				}

				// Apply Classes
				const mawClass = COSMETICS[cosmeticData.mawashi]?.class;
				const skinClass = COSMETICS[cosmeticData.skin]?.class;
				if (mawClass) e.classList.add(mawClass);
				if (skinClass) e.classList.add(skinClass);

				// --- STRIPE LOGIC ---
				let targetLoadout = null;

				if (isP1) {
					targetLoadout = this.playerLoadout;
				} else {
					if (this.mode === 'cpu') {
						targetLoadout = this.cpuLoadout || ['strike', 'sweep', 'thrust', 'throw'];
					} else if (this.mode === 'online') {
						targetLoadout = net.opponentLoadout || ['strike', 'sweep', 'thrust', 'throw'];
					} else {
						targetLoadout = ['strike', 'sweep', 'thrust', 'throw'];
					}
				}
				
				this.renderMawashiStripes(e, targetLoadout);
			}
		});

		// UI Cleanups (Always run these so the UI clears up for the victory text)
		const b1 = document.getElementById('p1-badge');
		const b2 = document.getElementById('p2-badge');
		if (b1) b1.classList.remove('show');
		if (b2) b2.classList.remove('show');
		const vs = document.getElementById('vs-icon');
		if (vs) vs.classList.remove('show');
		
		// Apply Top-Knot as Appropriate for experience level.
		this.updateAvatarHair();
	},
	
	generateCPUCosmetics: function(overrideDiff) {
		// Helper to filter your collection for what is actually unlocked
		const getRandomUnlocked = (type) => {
			const keys = Object.keys(COSMETICS).filter(k => {
				const item = COSMETICS[k];
				if (item.type !== type) return false;
				// Unlocked if no requirement OR player has the achievement
				return !item.req || (this.achievements && this.achievements[item.req]);
			});
			// Fallback to default if somehow nothing is found
			if (keys.length === 0) return type === 'mawashi' ? 'maw_default' : 'skin_default';
			return keys[Math.floor(Math.random() * keys.length)];
		};

		let isJonokuchi = false;
		let isChampion = false;

		// Determine the context of the current opponent
		if (overrideDiff !== undefined) {
			// Online CPU Fill routing
			if (overrideDiff === 0) isJonokuchi = true;
			if (overrideDiff >= 4) isChampion = true;
		} else if (this.career && this.career.activeBasho) {
			// Single Player Basho routing
			if (this.career.activeBasho.div === 0) isJonokuchi = true;
			if (this.career.activeBasho.div === 5 && this.currentOpponentRank) isChampion = true;
		} else {
			// Offline CPU match routing
			if (this.cpuDiff >= 4) isChampion = true;
		}

		let generatedData;

		if (isJonokuchi) {
			// Jonokuchi always uses basic gear
			generatedData = { mawashi: 'maw_default', skin: 'skin_default' };
		} else if (isChampion) {
			// Champions: Forced Gold Belt + Random unlocked Skin
			generatedData = { mawashi: 'maw_gold', skin: getRandomUnlocked('skin') };
		} else {
			// Standard opponents: Random choice from your unlocked collection
			generatedData = { 
				mawashi: getRandomUnlocked('mawashi'), 
				skin: getRandomUnlocked('skin') 
			};
		}

		// Save it to the game object for standard single-player logic
		this.currentOpponentCosmetics = generatedData;
		
		// RETURN it so Firebase can push it to the server!
		return generatedData;
	},

	renderMawashiStripes: function(element, loadout) {
		// 1. Clear existing stripes if any
		const existing = element.querySelector('.mawashi-stripes');
		if (existing) existing.remove();

		// 2. Create Container
		const container = document.createElement('div');
		container.className = 'mawashi-stripes';

		// --- NEW: INTERACTIVITY BINDINGS ---
		container.style.pointerEvents = 'auto'; 
		container.style.cursor = 'zoom-in';

		// GLOBAL DISMISSAL: Only attach this once to the document
		if (!window._mawashiStripeListenerAdded) {
			document.addEventListener('click', () => {
				// If the user taps anywhere on the screen, close all zoomed stripes
				document.querySelectorAll('.mawashi-stripes.zoomed').forEach(el => {
					el.classList.remove('zoomed');
					el.style.cursor = 'zoom-in';
				});
			});
			window._mawashiStripeListenerAdded = true;
		}

		// Toggle a 'zoomed' class on tap for mobile reliability
		container.addEventListener('click', (e) => {
			e.stopPropagation(); // Stop the click from bubbling up to our global dismissal listener

			const isCurrentlyZoomed = container.classList.contains('zoomed');

			// EXCLUSIVE ZOOM: Force-close ANY stripes that are currently open
			document.querySelectorAll('.mawashi-stripes.zoomed').forEach(el => {
				el.classList.remove('zoomed');
				el.style.cursor = 'zoom-in';
			});

			// If the one we just tapped wasn't already zoomed, zoom it in now!
			if (!isCurrentlyZoomed) {
				container.classList.add('zoomed');
				container.style.cursor = 'zoom-out';
			}
		});

		// --- DETERMINE DISABLED MOVES ---
		let sealedMoves = [];
		if (element.id === 'p1-rikishi' && this.p1 && this.p1.disabledMoves) {
			sealedMoves = this.p1.disabledMoves;
		} else if (element.id === 'p2-rikishi' && this.p2 && this.p2.disabledMoves) {
			sealedMoves = this.p2.disabledMoves;
		}

		// 3. Generate Stripes based on Loadout
		const kit = loadout || ['strike', 'sweep', 'thrust', 'throw'];
		
		if (kit.length === 5) {
			container.classList.add('five-dots');
		}

		kit.forEach(moveKey => {
			const move = MOVES[moveKey];
			if (!move) return;

			const span = document.createElement('span');
			span.dataset.move = moveKey;

			// --- RENDER RED X FOR SEALED MOVES ---
			if (sealedMoves.includes(moveKey)) {
				span.className = 'stripe sealed';
				// We counter-rotate the SVG by -45deg because the parent .stripe is rotated 45deg!
				span.innerHTML = `
					<svg viewBox="0 0 10 10" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); width: 8px; height: 8px; overflow: visible;">
						<line x1="2" y1="2" x2="8" y2="8" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round" />
						<line x1="8" y1="2" x2="2" y2="8" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round" />
					</svg>
				`;
			} else {
				if (move.type.includes('low')) {
					span.className = 'stripe low';
				} else {
					span.className = 'stripe high';
				}
			}

			container.appendChild(span);
		});

		element.appendChild(container);
	},
	
	triggerSealAnimation: function(playerNum, moveKey) {
		const el = document.getElementById(`p${playerNum}-rikishi`);
		if (!el) return;
		
		const stripe = el.querySelector(`.mawashi-stripes .stripe[data-move="${moveKey}"]`);
		if (stripe) {
			if (typeof sound !== 'undefined') sound.play('powerdown'); 
			
			// --- THE FIX: CLONE THE PIP TO PREVENT LAYOUT SHIFT ---
			// We duplicate the pip for the falling animation so the original 
			// stays in the DOM and holds its structural space!
			const fallingStripe = stripe.cloneNode(true);
			
			// Lock the clone in absolute space directly over the original
			fallingStripe.style.position = 'absolute';
			fallingStripe.style.left = stripe.offsetLeft + 'px';
			fallingStripe.style.top = stripe.offsetTop + 'px';
			fallingStripe.style.margin = '0'; // Clear any structural margins
			
			// Append the clone to the container
			stripe.parentElement.appendChild(fallingStripe);
			
			// Hide the original INSTANTLY so it vanishes but keeps the DOM intact
			stripe.style.visibility = 'hidden';
			
			// Animate the clone falling
			fallingStripe.classList.add('stripe-fall');
			
			// Remove only the clone after the drop animation finishes
			setTimeout(() => fallingStripe.remove(), 1200);
		}
	},

    log: function(msg) {
        const d = document.createElement('div');
        d.className = 'log-line';
        d.innerHTML = msg;
        
        const logArea = document.getElementById('log-area');
        logArea.appendChild(d);
        
        // --- THE FIX: Butter-smooth 60FPS scroll tracking ---
        const start = performance.now();
        
        const trackScroll = (now) => {
            logArea.scrollTop = logArea.scrollHeight;
            
            // Keep tracking for 450ms (just slightly longer than our 0.4s CSS animation)
            if (now - start < 450) { 
                requestAnimationFrame(trackScroll);
            }
        };
        
        // Kick off the tracking loop!
        requestAnimationFrame(trackScroll);
    },

	endGame: function() {
		// --- 1. INITIALIZATION & STATE CAPTURE ---
		let justRebirthed = false;
		let retiredStage = 0;
		let retiredExp = 0;
		let isFirstTimePromotion = false; 
		let isFirstYokozuna = false;
		this.wakiMatchUsage = 0;

		localStorage.removeItem('sumo_rage_quit_guard');
		
		const oldHairData = this.getExpAndHair ? this.getExpAndHair(true) : (this.career.hairData || { exp: 0 });
		const oldExp = oldHairData.exp || 0;
		const oldBashoIndex = this.career.bashoIndex || 0;
		
		gyoji.stopIdleTimer(); 
		gyoji.shout("SHOBU ARI!", 3000); 

		if (this.music) {
			this.music.stopMatchDrums();
		}
		
		this.resetAvatars();
		this.p1.build = null;
		this.p2.build = null;
		
		// Zero out all penalties so the reconciliation loop knows they are gone
		this.p1.cyclePenalty = 0;
		this.p1.pendingCyclePenalty = 0;
		this.p1.pendingShikiriPenalty = 0;
		
		this.p2.cyclePenalty = 0;
		this.p2.pendingCyclePenalty = 0;
		this.p2.pendingShikiriPenalty = 0;

		// Call the renderer to trigger the 'debuff-exit' animations on all remaining badges
		if (typeof this.renderDebuffs === 'function') {
			this.renderDebuffs(1);
			this.renderDebuffs(2);
		}
		
		let res = "";
		const isCpu = this.mode === 'cpu';
		let p1Wins = false;
		let p2Wins = false;
		let justPromoted = false;
		let isPerfectClear = false;
		
		if (this.p1.hp <= 0 && this.p2.hp <= 0) {
			const draws = ["DRAW - DOUBLE KO!", "MUTUAL DESTRUCTION!", "A DEADLY STALEMATE!", "NO VICTOR TODAY!", "SIMULTANEOUS DOWN!"];
			res = draws[Math.floor(Math.random() * draws.length)];
		} else if (this.p1.hp <= 0) {
			if (isCpu) {
				const cpuWins = ["DON'T GET DISCOURAGED!", "DUST YOURSELF OFF!", "TRAIN HARDER!", "A TEMPORARY SETBACK!", "STAND UP AND RETRY!"];
				res = cpuWins[Math.floor(Math.random() * cpuWins.length)];
			} else {
				const p2WinsMulti = ["PLAYER 2 REIGNS SUPREME!", "PLAYER 2 CLINCHES IT!", "PLAYER 2 TAKES GLORY!", "A MASTERCLASS BY P2!", "PLAYER 2 STANDS TALL!"];
				res = p2WinsMulti[Math.floor(Math.random() * p2WinsMulti.length)];
			}
			document.getElementById('p2-rikishi').classList.add('win-anim');
			p2Wins = true;
		} else {
			if (isCpu) {
				const p1WinsCpu = ["A GLORIOUS TRIUMPH!", "THE CROWD GOES WILD!", "YOU ARE UNSTOPPABLE!", "A LEGENDARY DISPLAY!", "FLAWLESS VICTORY!"];
				res = p1WinsCpu[Math.floor(Math.random() * p1WinsCpu.length)];
			} else {
				const p1WinsMulti = ["PLAYER 1 REIGNS SUPREME!", "PLAYER 1 CLINCHES IT!", "PLAYER 1 TAKES GLORY!", "A MASTERCLASS BY P1!", "PLAYER 1 STANDS TALL!"];
				res = p1WinsMulti[Math.floor(Math.random() * p1WinsMulti.length)];
			}
			document.getElementById('p1-rikishi').classList.add('win-anim');
			p1Wins = true;
		}
		
		if (p1Wins) { gyoji.showGunbai('p1'); } else if (p2Wins) { gyoji.showGunbai('p2'); }

		const isHost = (this.mode !== 'online' || net.side === 'host');
		const iWon = (isHost && p1Wins) || (!isHost && p2Wins);
		const me = isHost ? this.p1 : this.p2;
		const myFinalMove = isHost ? this.matchStats.finalP1Move : this.matchStats.finalP2Move;

		// Achievements & Kimarite Recording
		if (iWon && !this.isTutorial) {
			const attackMoves = ['strike', 'sweep', 'thrust', 'throw'];
			if (attackMoves.includes(myFinalMove)) {
				if (!this.stats.finishing_moves) this.stats.finishing_moves = [];
				if (!this.stats.finishing_moves.includes(myFinalMove)) {
					this.stats.finishing_moves.push(myFinalMove);
					this.log(`<span style="color:var(--gold)">New Kimarite Recorded: ${MOVES[myFinalMove].name}</span>`);
				}
				if (this.stats.finishing_moves.length === 4) this.unlockAchievement('kimarite');
			}
			if (me.hp === 1) this.unlockAchievement('hachinana');
			if (this.matchStats.rounds === 1) this.unlockAchievement('yorikiri');
			if (!this.matchStats.used_low) this.unlockAchievement('oshidashi');
			if (!this.matchStats.used_high) this.unlockAchievement('tsuridashi');
			if (this.matchStats.uniqueHits.length >= 3) this.unlockAchievement('sandan_gamae');
			
			// 1. Kihon (Common deck only)
			const deckIsPureCommon = this.career.activeDeck.every(k => {
				const data = this.RESOURCE_CARDS[k];
				return !data.rarity || data.rarity === 'common';
			});
			if (deckIsPureCommon) this.unlockAchievement('kihon');

			// 2. Onibi (Empty piles - The "Void" win)
			if (me.drawPile.length === 0 && me.discardPile.length === 0) {
				this.unlockAchievement('onibi');
			}

			// 3. Hyōhyō (No cycling/discarding throughout the match)
			if (!this.playerHasCycledThisMatch) {
				this.unlockAchievement('hyōhyō');
			}

			// 4. Kaeshi-waza (Recoil kill via Soppugata)
			if (this.lastDamageSource === 'recoil') {
				this.unlockAchievement('kaeshi_waza');
			}
		}
		
		this.stats.total_matches++;
		if (this.stats.total_matches >= 5) this.unlockAchievement('zambara');
		if (this.matchStats.rounds >= 15) this.unlockAchievement('mizu_iri');
		if (iWon && this.matchStats.roundsAtOneHP >= 3) this.unlockAchievement('dohyo_giwa');
		if (iWon && me.build === 'oshi' && me.hp >= 10) this.unlockAchievement('chankonabe');

		if (this.mode === 'cpu' && (!net || !net.isBashoCPUMatch)) {
			if (iWon && (this.cpuDiff >= 3)) {
				this.stats.cpu_win_streak = (this.stats.cpu_win_streak || 0) + 1;
				if (this.stats.cpu_win_streak >= 10) this.unlockAchievement('zensho_streak');
			} else if (!iWon) {
				this.stats.cpu_win_streak = 0;
			}
		}
		
		if (!this.isTutorial) this.updateMatchStats(p1Wins, p2Wins);
		const isDraw = !p1Wins && !p2Wins;
		
		if (this.mode === 'local' && !isDraw) {
			sound.play('win');
		} else if (iWon) {
			sound.play('win');
		} else {
			sound.play('lose');
		}
		
		this.log(`<div class="log-highlight">${res.replace(/\n/g, '<br>')}</div>`);
		
		let popupDelay = 1500; 
		if (this.mode === 'online' && !isDraw) {
			const isCasualMatch = net.matchRules && net.matchRules.isCasual;
			popupDelay = isCasualMatch ? 2500 : 4500; 
		}

		// --- 2. THE SINGLE PLAYER CAREER (UPDATED) ---
		if (isCpu && !this.isTutorial && this.career.activeBasho && (!net || !net.isBashoCPUMatch)) {
			const ab = this.career.activeBasho;
			const currentRules = this.DIVISIONS[ab.div];
			const maxBashoMatches = currentRules.maxMatches;
			
			if (p1Wins) {
				ab.wins++;
				ab.history.push('W');
				if (this.currentOpponentRank && !this.career.titles.includes(this.currentOpponentName)) {
					this.career.titles.push(this.currentOpponentName);
					res += `<br><span style="color:var(--gold)">TITLE EARNED: ${this.currentOpponentName.toUpperCase()}</span>`;
				}
				if (this.currentOpponentName === "Yokozuna") this.unlockAchievement('kinboshi');
				if (this.currentOpponentName === "Ozeki") this.unlockAchievement('ozeki_slayer');
				if (this.currentOpponentName === "Sekiwake") this.unlockAchievement('sekiwake_slayer');
			} else {
				ab.losses++;
				ab.history.push('L');
			}

			const matchesPlayed = ab.wins + ab.losses;
			const divName = this.DIVISIONS[ab.div].name.toUpperCase();

			let pipsHtml = `
			<div style="margin-top: 15px; margin-bottom: 10px; background: #fffbf0; padding: 15px; border-radius: 4px; border: 2px solid #4a3728; width: 90%; max-width: 400px; margin-left: auto; margin-right: auto; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
				<div style="display:flex; justify-content:space-between; margin-bottom:10px; font-weight:bold; font-family:var(--font-ui); color: #4a3728; letter-spacing: 1px;">
					<span>${divName}</span>
					<span style="color: #8b0000;">${ab.wins} - ${ab.losses}</span>
				</div>
				<div style="display: grid; grid-template-columns: repeat(${maxBashoMatches}, 1fr); gap: 3px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 4px;">
			`;
			for(let i = 0; i < maxBashoMatches; i++) {
				let pipClass = 'hoshitori-pip';
				if (i < ab.history.length) {
					pipClass += ab.history[i] === 'W' ? ' win' : ' loss';
					if (i === ab.history.length - 1) { pipClass += ' recent-pip'; }
				}
				pipsHtml += `<div class="${pipClass}"></div>`;
			}
			pipsHtml += `</div></div>`;
			res += pipsHtml;

			// --- THE JUDGEMENT PHASE (Triggered only at end of Basho) ---
			if (matchesPlayed >= maxBashoMatches) {
				const winRate = ab.wins / maxBashoMatches;
				const dice = Math.random();
				let judgement = "retained";

				// 1. Champion logic preserved
				if (ab.wins === maxBashoMatches) {
					if (ab.div === 5 && (this.career.highestPerfectDiv || 0) < 5) { isFirstYokozuna = true; }
					this.career.highestPerfectDiv = Math.max((this.career.highestPerfectDiv || 0), ab.div);
					isPerfectClear = true;
					const champBadges = ['champ_jonokuchi', 'champ_jonidan', 'champ_sandanme', 'champ_makushita', 'champ_juryo', 'champ_makuuchi'];
					if (champBadges[ab.div]) { this.unlockAchievement(champBadges[ab.div]); }
					res += `<br><strong class="pulsing-text" style="color:var(--accent-red); font-size: 1.2rem; text-shadow: 0 0 10px rgba(217, 58, 58, 0.4); letter-spacing: 2px;">DIVISION CHAMPION!</strong>`;
					judgement = 'promote';
				}

				// 2. Make-Koshi (Losing Record: 0% - 49%)
				else if (winRate < 0.50) {
					if (winRate <= 0.25) {
						judgement = "demote";
					} else {
						// Safety: As you get closer to 50%, the chance to stay (retain) increases
						const retainChance = 0.1 + ((winRate - 0.25) / 0.25) * 0.9;
						judgement = (dice <= retainChance) ? "retain" : "demote";
					}
				}
				// 3. Kachi-Koshi (Winning Record: 50% - 100%)
				else {
					// High win rates (roughly 12+ wins) still guarantee promotion
					if (winRate >= 0.80) {
						judgement = "promote";
					} else {
						// --- DYNAMIC PROMOTION SCALING ---
						let baseChance, difficultyWeight;

						if (ab.div < 3) {
							baseChance = 0.55; 
							difficultyWeight = 1.2; 
						} else {
							const rankHardness = (ab.div - 2); 
							baseChance = Math.max(0.05, 0.45 - (rankHardness * 0.15));
							difficultyWeight = 2.0; 
						}

						const winExcess = (winRate - 0.50) / 0.30; 
						const promoteChance = baseChance + (winExcess * difficultyWeight);

						judgement = (dice <= promoteChance) ? "promote" : "retain";
					}
				}

				// Apply Judgement
				if (judgement === "promote") {
					if (ab.div < 5 && this.career.unlockedDiv === ab.div) {
						this.career.unlockedDiv++;
						const nextName = this.DIVISIONS[this.career.unlockedDiv].name;
						res += `<br><span class="unlock-link">PROMOTED TO ${nextName.toUpperCase()}</span>`;
						justPromoted = true;
						if (this.career.unlockedDiv > (this.career.stats.highestDiv || 0)) { isFirstTimePromotion = true; }
						
						this.checkDivisionUnlocks(ab.div); 
						
					} else if (ab.div === 5) {
						res += `<br>Rank Retained!`;
						this.checkDivisionUnlocks(ab.div);
					} else {
						res += `<br>Rank Retained!`;
					}
				} else if (judgement === "demote") {
					if (ab.div > 0) {
						this.career.unlockedDiv = ab.div - 1;
						const prevName = this.DIVISIONS[this.career.unlockedDiv].name;
						res += `<br><span style="color:var(--accent-red)">📉 RELEGATED TO ${prevName.toUpperCase()}</span>`;
					} else {
						res += `<br>Record Reset.`;
					}
				} else {
					res += `<br>Rank Retained!`;
				}

				this.career.stats.bashosFinished[ab.div]++;
				const currentBest = this.career.stats.bestRecordWins[ab.div] || 0;
				if (ab.wins > currentBest) { this.career.stats.bestRecordWins[ab.div] = ab.wins; }
				this.career.practicedThisBasho = false;
				this.career.activeBasho = null;
				this.career.bashoIndex = ((this.career.bashoIndex || 0) + 1) % 6;
			}

			if (this.career.unlockedDiv > this.career.stats.highestDiv) { this.career.stats.highestDiv = this.career.unlockedDiv; }

			/* --- SCRAPPED REBIRTH SYSTEM ---
			   Playtesters opted against forcibly resetting progress. This block is commented out 
			   so the calendar rolls over to January (0) seamlessly without wiping the player's 
			   rank, build, or experience!

			if (oldBashoIndex === 5 && this.career.bashoIndex === 0) {
				justRebirthed = true;
				const hairData = this.getExpAndHair(true);
				
				 // Calculate Lifetime Eligible Wins
				const qp = this.career?.quickPlay || {};

				let lifetimeCpuWins = 0;
				Object.keys(qp).forEach(k => {
					if (k.startsWith('div_') || k.startsWith('cpu_')) {
						lifetimeCpuWins += (qp[k].wins || 0);
					}
				});

				const lifetimeOnlineWins = qp.online?.wins || 0;
				const lifetimeEligibleWins = lifetimeCpuWins + lifetimeOnlineWins;
				
				// Capture the current lifetime stats as the new "baseline"
				const s = this.career.style || { success: {a:0, b:0, d:0}, total: {a:0, b:0, d:0} };
				this.career.retiredActions = {
					success: (s.success.a || 0) + (s.success.b || 0) + (s.success.d || 0),
					total: (s.total.a || 0) + (s.total.b || 0) + (s.total.d || 0),
					wins: lifetimeEligibleWins
				};
				
				retiredStage = hairData.stage;
				retiredExp = hairData.exp;
				this.career.practiceExp = 0;
				this.career.expMult = (this.career.expMult || 1.0) + (retiredExp / 2000);
				this.career.unlockedDiv = this.career.highestPerfectDiv || 0;
				this.career.activeBasho = null; 
				
				// SANITIZE THE BUILD IMMEDIATELY
				this.currentBuildMom = 1; // Force reset to a basic Oshi-Zumo start
				this.playerBuildMom = 1;
				this.sanitizeBuild();
			}   
			*/
			
			this.saveCareer();
		}
		
		// --- 3. UI, ONLINE INTERCEPTOR, AND CINEMATIC EXIT ---
		const activeMatchId = net && net.matchId;
		setTimeout(() => {
			if (net && net.activeBashoId && net.matchId !== activeMatchId) return;
			const btn = document.getElementById('btn-post-action');
			const exitBtn = document.getElementById('btn-exit'); 
			const resEl = document.getElementById('post-match-res');
			const newHairData = this.getExpAndHair ? this.getExpAndHair(true) : (this.career.hairData || { exp: 0 });
			const currentExp = newHairData.exp || 0;
			
			const earnedMage = oldExp < MAGE_EXP && currentExp >= MAGE_EXP; 
			const earnedChonmage = oldExp < OCHOMAGE_EXP && currentExp >= OCHOMAGE_EXP;
			const earnedTsuyamage = oldExp < TSUYAMAGE_EXP && currentExp >= TSUYAMAGE_EXP; 
			const earnedOicho = oldExp < OICHOMAGE_EXP && currentExp >= OICHOMAGE_EXP;
			const milestoneReached = earnedMage || earnedChonmage || earnedTsuyamage || earnedOicho || justRebirthed;
			
			resEl.innerHTML = res;
			
			// --- BASHO INTERCEPTOR (ONLINE) ---
			if (net && net.activeBashoId && (this.mode === 'online' || net.isBashoCPUMatch)) {
				let winnerUID = 'draw';
				const didIWinLocally = this.mode === 'cpu' ? p1Wins : iWon;
				if (didIWinLocally) {
					winnerUID = window.currentUserUID;
				} else if (!isDraw) {
					const roundData = net.bashoData.schedule[net.bashoData.currentRound];
					const myPairing = roundData.find(p => p.p1 === window.currentUserUID || p.p2 === window.currentUserUID);
					if (myPairing) { winnerUID = (myPairing.p1 === window.currentUserUID) ? myPairing.p2 : myPairing.p1; }
				}

				let history = [];
				const totalRounds = Object.keys(net.bashoData.schedule).length;
				for (let r = 0; r < net.bashoData.currentRound; r++) {
					const roundData = net.bashoData.schedule[r];
					const match = roundData.find(p => p.p1 === window.currentUserUID || p.p2 === window.currentUserUID);
					if (match && match.winner && match.winner !== 'BYE') {
						if (match.winner === window.currentUserUID) history.push('W');
						else if (match.winner !== 'draw') history.push('L');
					}
				}
				if (iWon) history.push('W'); else if (!isDraw) history.push('L');

				let onlinePips = `
				<div style="margin-top: 15px; margin-bottom: 10px; background: #fffbf0; padding: 15px; border-radius: 4px; border: 2px solid #4a3728; width: 90%; max-width: 400px; margin-left: auto; margin-right: auto; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
					<div style="display:flex; justify-content:space-between; margin-bottom:10px; font-weight:bold; font-family:var(--font-ui); color: #4a3728; letter-spacing: 1px;">
						<span>${net.bashoData.name.toUpperCase()}</span>
						<span style="color: #8b0000;">${history.filter(x=>x==='W').length} - ${history.filter(x=>x==='L').length}</span>
					</div>
					<div style="display: grid; grid-template-columns: repeat(${totalRounds}, 1fr); gap: 3px; padding: 4px; background: rgba(0,0,0,0.03); border-radius: 4px;">
				`;
				for(let i = 0; i < totalRounds; i++) {
					let pipClass = 'hoshitori-pip' + (i < history.length ? (history[i] === 'W' ? ' win' : ' loss') : '') + (i === history.length - 1 ? ' recent-pip' : '');
					onlinePips += `<div class="${pipClass}"></div>`;
				}
				onlinePips += `</div></div>`;
				res += onlinePips;
				resEl.innerHTML = res;
				if (iWon || isDraw || net.isBashoCPUMatch) { net.reportBashoResult(winnerUID); }

				if (net.bashoFinished || (net.bashoData && net.bashoData.status === 'finished')) {
					btn.innerText = "TOURNAMENT COMPLETE (CONTINUE)";
					btn.onclick = () => {
						net.leaveBashoLobby();
						if (typeof this.abortPromotionCeremony === 'function') this.abortPromotionCeremony();
						if (typeof this.playCinematicExit === 'function') {
							this.playCinematicExit(() => game.exitToMenu(), cinematicContext);
						} else { game.exitToMenu(); }
					};
				} else {
					btn.innerText = "WAITING FOR ROUND TO FINISH...";
					btn.classList.add('pulsing-text');
					btn.disabled = true;
				}
				document.getElementById('post-match-overlay').classList.remove('hidden');
				return; 
			}
			
			if (this.mode === 'cpu' && res.includes('recent-pip')) {
				setTimeout(() => { if (typeof sound !== 'undefined' && sound.enabled) sound.play('calendar_drop'); }, 650); 
			}

			const isBashoEnd = this.mode === 'cpu' && res && (res.includes('Reset') || res.includes('PROMOTED') || res.includes('Retained') || res.includes('RELEGATED') || justRebirthed);
			const safeCalendar = this.BASHO_CALENDAR || [
				{ name: "Hatsu Basho", kanji: "初場所", month: "January" }, { name: "Haru Basho", kanji: "春場所", month: "March" },
				{ name: "Natsu Basho", kanji: "夏場所", month: "May" }, { name: "Nagoya Basho", kanji: "名古屋場所", month: "July" },
				{ name: "Aki Basho", kanji: "秋場所", month: "September" }, { name: "Kyushu Basho", kanji: "九州場所", month: "November" }
			];
			const newIdx = this.career.bashoIndex || 0;
			const oldIdx = (newIdx - 1 + 6) % 6; 
			const cinematicContext = { justRebirthed, retiredStage, retiredExp, isBashoEnd, nextSeason: safeCalendar[newIdx], prevSeason: safeCalendar[oldIdx], newHairData };

			if (exitBtn) {
				exitBtn.onclick = () => {
					this.abortPromotionCeremony();
					if (this.mode === 'online') net.reset(); 
					this.playCinematicExit(() => game.exitToMenu(), cinematicContext);
				};
			}

			if (this.mode === 'cpu') {
				if (this.career.activeBasho) {
					const day = this.career.activeBasho.wins + this.career.activeBasho.losses + 1;
					btn.innerText = `NEXT BOUT (Day ${day})`;
					btn.onclick = () => { 
						this.abortPromotionCeremony(); 
						if (milestoneReached) {
							this.playCinematicExit(() => game.rematch(), cinematicContext);
						} else {
							game.rematch(); 
						}
					};
				} else if (isBashoEnd) {
					btn.innerText = "RETURN TO STABLE";
					btn.onclick = () => { 
						this.abortPromotionCeremony(); 
						this.playCinematicExit(() => game.openCampaign(), cinematicContext); 
					};
				} else {
					btn.innerText = "REMATCH";
					btn.onclick = () => { 
						this.abortPromotionCeremony(); 
						if (milestoneReached) {
							this.playCinematicExit(() => game.rematch(), cinematicContext);
						} else {
							game.rematch(); 
						}
					};
				}
			} else {
				btn.innerText = "REMATCH";
				btn.onclick = () => { 
					this.abortPromotionCeremony(); 
					if (milestoneReached) {
						this.playCinematicExit(() => game.rematch(), cinematicContext);
					} else {
						game.rematch(); 
					}
				};
			}

			document.getElementById('post-match-overlay').classList.remove('hidden');

			// Looting System
			const isQualifyingMatch = iWon && (this.mode === 'cpu' || (this.mode === 'online' && net && (!net.matchRules || !net.matchRules.isCasual)));
			if (isQualifyingMatch && typeof this.processLoot === 'function') {
				this.processLoot(this.matchStats.rounds, this.history || []);
				if (this.pendingMatchLoot && this.pendingMatchLoot.length > 0) {
					this.renderLootUI(this.pendingMatchLoot, "KENSHŌ 見性");
					this.pendingMatchLoot = null; 
				}
			}
			
			if (justPromoted) {
				const unlockMap = { 1: 'hook', 2: 'crush', 3: 'trip', 4: 'twist', 5: 'nodowa' };
				const unlockedMoveKey = unlockMap[this.career.unlockedDiv] || 'strike';
				this.playPromotionCeremony(this.DIVISIONS[this.career.unlockedDiv].name, this.DIVISIONS[this.career.unlockedDiv].kanji, unlockedMoveKey, isFirstTimePromotion, isPerfectClear);
			}
			if (this.career.highestPerfectDiv === 5 && res.includes('Retained') && !justPromoted) {
				this.playPromotionCeremony("Yokozuna", "横綱", "utchari", isFirstYokozuna, isPerfectClear);
			}
		}, popupDelay);
	},
	
	playCinematicExit: function(routingCallback, context = {}) {
        document.body.classList.remove('game-over-active');
        document.getElementById('post-match-overlay').classList.add('hidden');
        
        const promoEl = document.getElementById('promotion-ceremony'); 
        if(promoEl) promoEl.classList.add('hidden');

        // Extract context with fallbacks for practice mode
        const justRebirthed = context.justRebirthed || false;
        const retiredStage = context.retiredStage || 0;
        const retiredExp = context.retiredExp || 0;
        const isBashoEnd = context.isBashoEnd || false;
        const nextSeason = context.nextSeason || { name: "", kanji: "", month: "" };
        const prevSeason = context.prevSeason || { name: "", kanji: "", month: "" };
        const newHairData = context.newHairData || (this.getExpAndHair ? this.getExpAndHair(true) : (this.career.hairData || { exp: 0 }));

        // Assuming OICHOMAGE_EXP is available in this scope (or global)
        const maxExp = typeof OICHOMAGE_EXP !== 'undefined' ? OICHOMAGE_EXP : 2000; 
        
        const baseExp = Math.min(newHairData.exp || 0, maxExp);
        const progressPct = baseExp / maxExp;
        const baseClipHeight = 100 + (progressPct * 150);

        const retExp = Math.min(retiredExp || 0, maxExp);
        const retProgressPct = retExp / maxExp;
        const retiredClipHeight = 100 + (retProgressPct * 150);

        const renderStage = justRebirthed ? retiredStage : newHairData.stage;
        const renderTitle = justRebirthed ? (retiredStage >= 4 ? "Oicho-mage" : retiredStage >= 3 ? "Tsuyamage" : retiredStage >= 2 ? "Chonmage" : retiredStage >= 1 ? "Mage" : "Zambara") : newHairData.title;
        const renderClipHeight = justRebirthed ? retiredClipHeight : baseClipHeight;
        const isMax = renderStage >= 4;

        let flavorText = "As each strand grows, so too does your knowledge and ability.";
        if (renderStage >= 1) flavorText = "The Mage is bound. Your expanding repertoire demands more resolve.";
        if (renderStage >= 2) flavorText = "The Chonmage is tied. You are now a battle-tested Rikishi.";
        if (renderStage >= 3) flavorText = "The scent of bintsuke oil is heavy. You are on the cusp of true greatness."; 
        if (isMax) flavorText = "The Ginkgo leaf is set. You have reached the pinnacle of the Tokoyama's art.";

        let topknotHtml = '';
        if (renderStage >= 4) {
            topknotHtml = `
            <g style="${justRebirthed ? 'opacity: 1; animation: hairCutFall 1.2s cubic-bezier(0.5, -0.2, 0.7, 1) 4.2s forwards;' : 'opacity: 0; animation: topknotReveal 1s ease-out 2.2s forwards;'}">
                <ellipse cx="100" cy="45" rx="24" ry="14" fill="url(#hairSheen-endgame)" />
                <path d="M 85 45 L 100 32 L 115 45" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none"/>
            </g>`;
        } else if (renderStage >= 2) {
            topknotHtml = `
            <g style="${justRebirthed ? 'opacity: 1; animation: hairCutFall 1.2s cubic-bezier(0.5, -0.2, 0.7, 1) 4.2s forwards;' : 'opacity: 0; animation: topknotReveal 1s ease-out 2.2s forwards;'}">
                <ellipse cx="100" cy="48" rx="18" ry="11" fill="url(#hairSheen-endgame)" />
                <path d="M 90 48 Q 100 40 110 48" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/>
            </g>`;
        }

        const cinematicOverlay = document.createElement('div');
        cinematicOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: #000000; z-index: 10000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.8s ease;
        `;
        document.body.appendChild(cinematicOverlay);

        requestAnimationFrame(() => cinematicOverlay.style.opacity = '1');

        setTimeout(() => {
            let htmlContent = `
                <style>
                    @keyframes sumoRecordFade { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
                    @keyframes topknotReveal { from { opacity: 0; transform: scale(0.8) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                    @keyframes calendarDrop { 0% { opacity: 0; transform: translateY(-10px); } 100% { opacity: 1; transform: translateY(0); } }
                    @keyframes paperTear {
                        0% { transform: rotate(0deg) translateY(0) scale(1); opacity: 1; filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
                        25% { transform: rotate(3deg) translateY(20px) scale(1.02); opacity: 1; filter: drop-shadow(0 15px 15px rgba(0,0,0,0.3)); }
                        100% { transform: rotate(15deg) translateY(400px) scale(0.9); opacity: 0; filter: drop-shadow(0 20px 20px rgba(0,0,0,0.1)); }
                    }
                    @keyframes hairCutFall {
                        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                        15% { transform: translateY(-15px) rotate(-15deg); opacity: 1; } 
                        100% { transform: translateY(200px) rotate(45deg); opacity: 0; }
                    }
                    @keyframes textFadeOut { from {opacity: 1;} to {opacity: 0;} }
                    @keyframes textFadeIn { from {opacity: 0;} to {opacity: 1;} }
                </style>
                <div id="cinematic-content" style="
                    animation: sumoRecordFade 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
                    background: rgba(255, 255, 255, 0.95); padding: 25px; border: 1px solid #4a3728; 
                    border-radius: 12px; display: flex; flex-wrap: wrap; 
                    align-items: center; justify-content: center; gap: 20px; 
                    box-shadow: 0 10px 40px rgba(0,0,0,0.5); max-width: 600px; width: 90%;
                ">
                    <div style="width: 130px; height: 160px; flex-shrink: 0; border-radius: 50% 50% 10px 10px; background: #fff; border: 2px solid rgba(74, 55, 40, 0.2); overflow: hidden; display: flex; justify-content: center; align-items: flex-end; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                        <svg viewBox="0 0 200 250" width="100%" height="100%" style="display: block;">
                            <defs>
                                <clipPath id="hairProgress-endgame">
                                    <rect x="0" y="0" width="200" height="${justRebirthed ? retiredClipHeight : 100}">
                                        ${!justRebirthed ? `
                                            <animate attributeName="height" from="100" to="${renderClipHeight}" dur="1.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.45 0.05 0.55 0.95" begin="0.8s" />
                                        ` : `
                                            <animate attributeName="height" from="${retiredClipHeight}" to="100" dur="0.3s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1" begin="4.2s" />
                                        `}
                                    </rect>
                                </clipPath>
                                <linearGradient id="pearlSkin-endgame" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="#ffffff" /><stop offset="50%" stop-color="#f8f8f8" /><stop offset="100%" stop-color="#e8e8e8" />
                                </linearGradient>
                                <linearGradient id="hairSheen-endgame" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stop-color="#050505" /><stop offset="25%" stop-color="#222" /><stop offset="50%" stop-color="#333" /><stop offset="75%" stop-color="#222" /><stop offset="100%" stop-color="#050505" />
                                </linearGradient>
                            </defs>

                            <g clip-path="url(#hairProgress-endgame)">
                                <path d="M 50 100 C 5 160 15 230 30 260 L 170 260 C 185 230 195 160 150 100 Z" fill="url(#hairSheen-endgame)"/>
                            </g>

                            <path d="M 20 260 C 20 180 70 160 100 160 C 130 160 180 180 180 260 Z" fill="url(#pearlSkin-endgame)" stroke="#aaa" stroke-width="1.5"/>
                            <rect x="85" y="135" width="30" height="35" fill="url(#pearlSkin-endgame)" stroke="#aaa" stroke-width="1.5"/>
                            <ellipse cx="58" cy="115" rx="6" ry="12" fill="url(#pearlSkin-endgame)" stroke="#aaa" stroke-width="1.5"/>
                            <ellipse cx="142" cy="115" rx="6" ry="12" fill="url(#pearlSkin-endgame)" stroke="#aaa" stroke-width="1.5"/>
                            <path d="M 60 100 C 60 45 140 45 140 100 C 140 155 60 155 60 100 Z" fill="url(#pearlSkin-endgame)" stroke="#aaa" stroke-width="1.5"/>
                            <path d="M 59 100 C 55 50 145 50 141 100 C 141 75 59 75 59 100 Z" fill="url(#hairSheen-endgame)"/>

                            <g clip-path="url(#hairProgress-endgame)">
                                <path d="M 65 100 C 45 155 85 200 65 255" stroke="url(#hairSheen-endgame)" stroke-width="12" stroke-linecap="round" fill="none"/>
                                <path d="M 135 100 C 155 155 115 200 135 255" stroke="url(#hairSheen-endgame)" stroke-width="12" stroke-linecap="round" fill="none"/>
                                <path d="M 67 110 C 50 155 87 200 67 245" stroke="rgba(255,255,255,0.1)" stroke-width="2" fill="none"/>
                            </g>
                            ${topknotHtml}
                        </svg>
                    </div>

                    <div style="flex: 1; min-width: 200px; text-align: center; opacity: 0; animation: sumoRecordFade 1s cubic-bezier(0.2, 0.8, 0.2, 1) 2.8s forwards;">
                        <div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 3px; color: #888; margin-bottom: 5px;">Mage-yui • 髪結い</div>
                        <div style="font-size: clamp(1.2rem, 6vw, 2rem); font-family: 'serif'; font-weight: bold; color: #4a3728; line-height: 1.1; word-wrap: break-word;">
                            ${renderTitle}
                        </div>
                        <div style="position: relative; height: 50px; margin-top: 15px; font-size: 0.8rem; line-height: 1.4; max-width: 300px; margin-left: auto; margin-right: auto;">
                            <div style="position: absolute; width: 100%; top: 0; left: 0; color: #666; font-style: italic; opacity: 1; ${justRebirthed ? 'animation: textFadeOut 0.3s forwards 4.0s;' : ''}">
                                ${flavorText}
                            </div>
                            ${justRebirthed ? `
                            <div style="position: absolute; width: 100%; top: 0; left: 0; color: #8b0000; font-weight: bold; opacity: 0; animation: textFadeIn 0.5s forwards 4.3s;">
                                A year has passed. The knot is cut.
                            </div>
                            ` : ''}
                        </div>
                        ${(!justRebirthed && isMax) ? `<div style="margin-top: 5px; display: inline-block; padding: 4px 12px; border: 1px solid #8b0000; color: #8b0000; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; border-radius: 20px;">Mastered Rank</div>` : ''}
                    </div>
                </div>
            `;

            if (isBashoEnd) {
                htmlContent += `
                <div id="cinematic-calendar" style="position: relative; width: 90%; max-width: 450px; margin-top: 25px; opacity: 0; animation: calendarDrop 0.8s ease-out 3.8s forwards;">
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 20px; background: #fffcf5 url('https://www.transparenttextures.com/patterns/rice-paper.png'); box-shadow: inset 0 0 30px rgba(139, 0, 0, 0.05), 0 4px 10px rgba(0,0,0,0.1); border-top: 4px double #8b0000; border-bottom: 4px double #8b0000; border-radius: 4px; padding: 15px 25px; box-sizing: border-box;">
                        <div style="text-align: right; line-height: 1.2; flex: 1;">
                            <div style="font-size: 0.8rem; color: #666; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-family: sans-serif;">NEXT UP: ${nextSeason.month}</div>
                            <div style="font-size: 1.4rem; font-weight: bold; color: #8b0000; font-family: 'Georgia', serif; letter-spacing: 0.5px; text-shadow: 1px 1px 0 rgba(255,255,255,0.5);">${nextSeason.name}</div>
                        </div>
                        <div style="width: 1px; height: 45px; background: repeating-linear-gradient(to bottom, #c0a080 0px, #c0a080 4px, transparent 4px, transparent 8px);"></div>
                        <div style="flex: 0 0 auto; font-size: 2.8rem; font-family: var(--font-jap), serif; color: #2c2c2c; line-height: 1; text-shadow: 2px 2px 0px #eaddcf, 3px 3px 2px rgba(0,0,0,0.2);">${nextSeason.kanji}</div>
                    </div>

                    <div style="position: relative; width: 100%; transform-origin: top right; z-index: 2; animation: paperTear 1.5s cubic-bezier(0.55, 0.085, 0.68, 0.53) 5.0s forwards; display: flex; align-items: center; justify-content: center; gap: 20px; background: #fffcf5 url('https://www.transparenttextures.com/patterns/rice-paper.png'); box-shadow: inset 0 0 30px rgba(139, 0, 0, 0.05), 0 4px 10px rgba(0,0,0,0.1); border-top: 4px double #8b0000; border-bottom: 4px double #8b0000; border-radius: 4px; padding: 15px 25px; box-sizing: border-box;">
                        <div style="text-align: right; line-height: 1.2; flex: 1;">
                            <div style="font-size: 0.8rem; color: #666; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-family: sans-serif;">COMPLETED: ${prevSeason.month}</div>
                            <div style="font-size: 1.4rem; font-weight: bold; color: #8b0000; font-family: 'Georgia', serif; letter-spacing: 0.5px; text-shadow: 1px 1px 0 rgba(255,255,255,0.5);">${prevSeason.name}</div>
                        </div>
                        <div style="width: 1px; height: 45px; background: repeating-linear-gradient(to bottom, #c0a080 0px, #c0a080 4px, transparent 4px, transparent 8px);"></div>
                        <div style="flex: 0 0 auto; font-size: 2.8rem; font-family: var(--font-jap), serif; color: #2c2c2c; line-height: 1; text-shadow: 2px 2px 0px #eaddcf, 3px 3px 2px rgba(0,0,0,0.2);">${prevSeason.kanji}</div>
                    </div>
                </div>
                `;
            }
            
            if (justRebirthed) {
                const currentMult = (this.career.expMult || 1.0).toFixed(2);
                htmlContent += `
                <div id="cinematic-rebirth-hair" style="
                    width: 90%; max-width: 450px; text-align: center; margin-top: 25px;
                    background: rgba(15, 15, 15, 0.95); padding: 20px; border-radius: 8px; border: 1px solid #b8860b;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
                    opacity: 0; animation: textFadeIn 1s ease-out 5.5s forwards;
                ">
                    <div style="font-family: 'Georgia', serif; color: #b8860b; font-weight: bold; margin-bottom: 5px; letter-spacing: 2px;">
                        A NEW CYCLE BEGINS
                    </div>
                    <div style="font-size: 0.85rem; color: #aaa; margin-bottom: 15px; font-style: italic; line-height: 1.4;">
                        The path to become your best <br>
                        <span style="color: #fff; font-weight: bold;">Experience Rate Increased to ${currentMult}x</span>
                    </div>
                    <svg viewBox="0 0 100 50" width="80" height="40" style="display:inline-block; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6)); transform: rotate(-5deg);">
                        ${retiredStage >= 4 ? `
                            <ellipse cx="50" cy="25" rx="30" ry="15" fill="#111" />
                            <path d="M 30 25 L 50 10 L 70 25" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/>
                        ` : retiredStage >= 2 ? `
                            <ellipse cx="50" cy="25" rx="20" ry="12" fill="#111" />
                            <path d="M 40 25 Q 50 15 60 25" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/>
                        ` : `
                            <path d="M 35 25 Q 50 10 65 30" stroke="#111" stroke-width="3" stroke-linecap="round" fill="none"/>
                        `}
                    </svg>
                </div>
                `;
            }

            cinematicOverlay.innerHTML = htmlContent;
        }, 800);
        
        if (!justRebirthed && baseClipHeight > 100) {
            setTimeout(() => {
                if (typeof sound !== 'undefined') sound.play('hair_grow');
            }, 1600);
        }

        if (isBashoEnd) {
            setTimeout(() => {
                if (typeof sound !== 'undefined') sound.play('calendar_drop');
            }, 5400); 
        }

        if (justRebirthed) {
            setTimeout(() => {
                if (typeof sound !== 'undefined') sound.play('hair_cut');
            }, 5180);
        }

        let holdTime = 7500;
        if (isBashoEnd) holdTime = 9500;
        if (justRebirthed) holdTime = 11500; 
        
        let transitionTime = holdTime + 1000;

        setTimeout(() => {
            const content = document.getElementById('cinematic-content');
            const calendar = document.getElementById('cinematic-calendar');
            const rebirthHair = document.getElementById('cinematic-rebirth-hair');
            
            if (content) {
                content.style.transition = 'opacity 1s ease, transform 1s ease';
                content.style.opacity = '0';
                content.style.transform = 'translateY(-15px)';
            }
            if (calendar) {
                calendar.style.transition = 'opacity 1s ease';
                calendar.style.opacity = '0';
            }
            if (rebirthHair) {
                rebirthHair.style.transition = 'opacity 1s ease';
                rebirthHair.style.opacity = '0';
            }
        }, holdTime);

        setTimeout(() => {
            routingCallback(); 
            setTimeout(() => {
                cinematicOverlay.style.opacity = '0';
                setTimeout(() => cinematicOverlay.remove(), 800);
            }, 100);
        }, transitionTime); 
    },
	
	abortPromotionCeremony: function() {
		// 1. Kill every scheduled animation timeout
		if (this.promoTimeouts) {
			this.promoTimeouts.forEach(timer => clearTimeout(timer));
		}
		this.promoTimeouts = [];
		
		// 2. Safety cleanup: Remove screen shake if interrupted mid-quake
		if (document.body) {
			document.body.classList.remove('shake-active');
		}
		
		// 3. Safety cleanup: Reset the Stable button if interrupted mid-slide
		const heyaBtn = document.getElementById('global-heya-btn'); 
		if (heyaBtn) {
			heyaBtn.classList.remove('slide-in-bottom-left');
		}
	},

	// --- UPDATED: Accepts BOTH isFirstTime and isPerfectClear parameters ---
    playPromotionCeremony: function(newRankEnglish, newRankKanji, unlockedMoveKey, isFirstTime, isPerfectClear = false) {
        this.abortPromotionCeremony(); 
        this.promoTimeouts = [];

        const stage = document.getElementById('promotion-stage');
        if (!stage) {
            console.error("Promotion stage container not found in DOM!");
            return; 
        }

        const p1Avatar = document.getElementById('p1-rikishi');
        const currentSkin = Array.from(p1Avatar.classList).find(cls => cls.startsWith('skin-')) || '';
        const currentMawashi = Array.from(p1Avatar.classList).find(cls => cls.startsWith('mawashi-')) || '';

        const giftGraphic = MOVE_ICONS[unlockedMoveKey] || '📜';

        // --- UPDATED: Conditionally render the gift HTML (if first time) AND the ribbon (if perfect) ---
        stage.innerHTML = `
            <div id="promo-rikishi" class="rikishi entering p1 ${currentSkin} ${currentMawashi}">
                <div class="mawashi-sparkles">
                    <div class="sparkle s1">✦</div>
                    <div class="sparkle s2">✨</div>
                    <div class="sparkle s3">✦</div>
                </div>
            </div>
            
            <div id="banzuke-sign" class="hidden">
                <div id="banzuke-parchment">
                    <div class="promo-kanji">${newRankKanji}</div>
                    <div class="promo-english">${newRankEnglish}</div>
                </div>
                
                ${isPerfectClear ? `
                <div id="promo-ribbon" class="promo-ribbon hidden">
                </div>
                ` : ''}
            </div>
            
            ${isFirstTime ? `
            <div id="promo-gift" class="hidden" style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.9); border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                ${giftGraphic}
            </div>
            ` : ''}
        `;

        const rikishi = document.getElementById('promo-rikishi');
        const sign = document.getElementById('banzuke-sign');
        const parchment = document.getElementById('banzuke-parchment');

        // --- THE ANIMATION TIMELINE ---

        this.promoTimeouts.push(setTimeout(() => {
            rikishi.classList.remove('entering');
            rikishi.classList.add('looking-up');
            sign.classList.remove('hidden');
            sign.classList.add('dropping');
        }, 2500));

        this.promoTimeouts.push(setTimeout(() => {
            if (sound.enabled) sound.play('boom');
            document.body.classList.add('shake-active');
            this.promoTimeouts.push(setTimeout(() => document.body.classList.remove('shake-active'), 400));
        }, 2800));

        this.promoTimeouts.push(setTimeout(() => {
            sign.classList.remove('dropping'); 
            sign.classList.add('dropped');     
            sign.classList.add('sign-rumble');
        }, 3100));

        this.promoTimeouts.push(setTimeout(() => {
            sign.classList.remove('sign-rumble');
            parchment.classList.add('unfurling');
            if (sound.enabled) sound.play('paper-unfurl');
            
            // --- NEW: Pop the ribbon out immediately after the unfurl begins ---
            if (isPerfectClear) {
                setTimeout(() => {
                    const ribbon = document.getElementById('promo-ribbon');
                    if (ribbon) {
                        ribbon.classList.remove('hidden');
                        ribbon.classList.add('gift-pop'); // Reuse your awesome pop animation!
                        if (sound.enabled) sound.play('powerup');
                    }
                }, 300); // 300ms delay so it syncs perfectly with the scroll opening
            }
        }, 3500));

        // --- EXISTING: Wrap Gift animations in isFirstTime check ---
        if (isFirstTime) {
            this.promoTimeouts.push(setTimeout(() => {
                const gift = document.getElementById('promo-gift');
                if (gift) {
                    gift.classList.remove('hidden');
                    gift.classList.add('gift-pop');
                }
            }, 3800));
        }

        this.promoTimeouts.push(setTimeout(() => {
            rikishi.classList.remove('looking-up');
            rikishi.classList.add('shiko-stomp');
        }, 4200));

        this.promoTimeouts.push(setTimeout(() => {
            if (sound.enabled) sound.play('boom');
            document.body.classList.add('shake-active');
            this.promoTimeouts.push(setTimeout(() => document.body.classList.remove('shake-active'), 300));
            
            rikishi.classList.add('proud-nod');
            this.spawnConfetti(stage);
        }, 4800));

        // --- EXISTING: Wrap the Stable Slide/Gift Float in isFirstTime check ---
        if (isFirstTime) {
            this.promoTimeouts.push(setTimeout(() => {
                const heyaBtn = document.getElementById('global-heya-btn');
                if (heyaBtn) {
                    heyaBtn.classList.remove('hidden');
                    heyaBtn.classList.add('slide-in-bottom-left');
                }
                
                const gift = document.getElementById('promo-gift');
                if (gift) {
                    const rect = gift.getBoundingClientRect();
                    gift.style.position = 'fixed';
                    gift.style.left = rect.left + 'px';
                    gift.style.top = rect.top + 'px';
                    gift.style.margin = '0';
                    gift.classList.remove('gift-pop'); 
                    
                    void gift.offsetWidth;
                    
                    gift.style.transition = 'all 0.6s cubic-bezier(0.55, 0.085, 0.68, 0.53)';
                    gift.style.left = '40px'; 
                    gift.style.top = 'calc(100vh - 60px)'; 
                    gift.style.transform = 'scale(0.2)'; 
                    gift.style.opacity = '0.5';
                }
            }, 5500));

            this.promoTimeouts.push(setTimeout(() => {
                const gift = document.getElementById('promo-gift');
                if (gift) gift.style.opacity = '0'; 
                
                if (sound.enabled) sound.play('powerup');
                
                const heyaBtn = document.getElementById('global-heya-btn');
                if (heyaBtn) {
                    heyaBtn.classList.add('stable-notification');
                    const label = heyaBtn.querySelector('.heya-label');
                    if (label) {
                        label.innerText = "STABLE"; 
                        label.style.color = "";     
                    }
                }
            }, 6100));
        }
        
        const heyaBtn = document.getElementById('global-heya-btn');
        if (heyaBtn) heyaBtn.classList.remove('slide-in-bottom-left');
    },
	
	spawnConfetti: function(stageContainer) {
        const colors = ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
        const burstAmount = 60;

        // 1. Calculate WebGL coordinates from the DOM element
        const rect = stageContainer.getBoundingClientRect();
        const spawnX = rect.left + (rect.width / 2);
        const spawnY = rect.top + (rect.height / 2);

        for (let i = 0; i < burstAmount; i++) {
            const hex = colors[Math.floor(Math.random() * colors.length)];
            const color = this.hexToRgb(hex);

            const angle = Math.random() * Math.PI * 2;
            
            // 2. Translate total CSS distance into per-frame velocity
            // We divide by 10 to give a fast initial punch that friction will slow down
            const force = (40 + Math.random() * 80) / 10; 
            
            const vx = Math.cos(angle) * force;
            
            // The CSS -60 upward bias translates to roughly -6.0 initial Y velocity
            const vy = (Math.sin(angle) * force) - 6.0; 
            
            // Translate CSS total rotation into Radians per frame
            const rotSpeed = ((Math.random() * 360 + 180) * (Math.PI / 180)) / 60;

            // Emit! The final 1.0 tells the shader it's Confetti
            vfx.emit(spawnX, spawnY, vx, vy, 8, color.r, color.g, color.b, 1.0, 2500, Math.random() * Math.PI * 2, rotSpeed, 1.0);
        }
    },
	
	// =========================================
	// ENDGAME LOOTING SYSTEM
	// =========================================
	
	processLoot: function(rounds, playerHistory) {
		// 1. Determine Amount of Cards (Based on Turn Count)
		let r = Math.random();
		let numCards = 1;
		
		if (rounds <= 5) {
			if (r > 0.95) numCards = 3; else if (r > 0.85) numCards = 2;
		} else if (rounds <= 12) {
			if (r > 0.70) numCards = 3; else if (r > 0.10) numCards = 2;
		} else {
			if (r > 0.30) numCards = 3; else if (r > 0.05) numCards = 2;
		}

		// 2. Determine Opponent Tier (0 to 5)
		let tier = 0;
		if (this.mode === 'online' && typeof net !== 'undefined') {
			let oppHosho = net.opponentHosho || 0;
			tier = Math.floor(oppHosho / 500);
		} else {
			tier = this.cpuDiff !== undefined ? this.cpuDiff : 0;
		}
		tier = Math.max(0, Math.min(5, tier));

		// --- NEW: RANK-SPECIFIC "BOSS DROP" CALCULATIONS ---
		const oppName = this.currentOpponentName || "";
		const isYokozuna = oppName.includes('Yokozuna');
		const isOzeki = oppName.includes('Ozeki');
		const isSekiwake = oppName.includes('Sekiwake');
		
		let bossCardToAward = null;
		
		// --- THE FIX: Yokozuna drops one half of the ultimate seal! ---
		if (isYokozuna && Math.random() < 0.90) {
			bossCardToAward = Math.random() > 0.95 ? 'a_gyo' : 'un_gyo';
		}
		else if (isOzeki && Math.random() < 0.90) bossCardToAward = 'hassotobi';
		else if (isSekiwake && Math.random() < 0.90) bossCardToAward = 'kimedashi';
		
		let bossAwarded = false;

		// 3. RARITY PROBABILITIES
		const lootTables = [
			{ l: 0.00, e: 0.00, r: 0.05 }, // Tier 0
			{ l: 0.00, e: 0.01, r: 0.09 }, // Tier 1
			{ l: 0.0025, e: 0.045, r: 0.1025 }, // Tier 2
			{ l: 0.0025, e: 0.065, r: 0.1825 }, // Tier 3
			{ l: 0.0075, e: 0.1325, r: 0.26 }, // Tier 4
			{ l: 0.01, e: 0.22, r: 0.37 }  // Tier 5
		];
		const probs = lootTables[tier];

		// Build pools from blueprints
		const rarePool = [];
		const epicPool = [];
		const legPool = [];
		for (let key in this.RESOURCE_CARDS) {
			let rarity = this.RESOURCE_CARDS[key].rarity || 'common';
			if (rarity === 'rare') rarePool.push(key);
			else if (rarity === 'epic') epicPool.push(key);
			else if (rarity === 'legendary') legPool.push(key);
		}

		// 4. Common Card Usage Weights
		let weights = { atk: 25, def: 25, util: 25 };
		if (playerHistory && playerHistory.length) {
			playerHistory.forEach(moveKey => {
				if (MOVES[moveKey]) {
					if (MOVES[moveKey].type.includes('atk')) weights.atk += 3;
					else if (MOVES[moveKey].type.includes('def')) weights.def += 3;
					else if (MOVES[moveKey].type.includes('util')) weights.util += 3;
				}
			});
		}
		let totalCommonWeight = weights.atk + weights.def + weights.util;
		let lootedCards = [];
		
		// --- CRITICAL FIX: Ensure baseline collection exists BEFORE adding loot! ---
		if (this.career) {
			if (!this.career.cardCollection || Object.keys(this.career.cardCollection).length === 0) {
				this.career.cardCollection = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
			}
			if (!this.career.activeDeck || this.career.activeDeck.length === 0) {
				this.career.activeDeck = [];
				const defaultCounts = { 'h_attack': 2, 'l_attack': 2, 'h_block': 2, 'l_block': 2, 'build': 7 };
				Object.keys(defaultCounts).forEach(type => {
					for (let i = 0; i < defaultCounts[type]; i++) this.career.activeDeck.push(type);
				});
			}
		}
		// --------------------------------------------------------------------------

		// 5. Roll for Loot
		for (let i = 0; i < numCards; i++) {
			let specificCard = '';

			// If a boss card is slated and hasn't been given yet, override the first slot
			if (bossCardToAward && !bossAwarded) {
				specificCard = bossCardToAward;
				bossAwarded = true;
			} else {
				// Standard Rarity Rolling
				let rarityRoll = Math.random();
				let selectedRarity = 'common';

				if (rarityRoll < probs.l) selectedRarity = 'legendary';
				else if (rarityRoll < probs.l + probs.e) selectedRarity = 'epic';
				else if (rarityRoll < probs.l + probs.e + probs.r) selectedRarity = 'rare';

				// Fallbacks
				if (selectedRarity === 'legendary' && legPool.length === 0) selectedRarity = 'epic';
				if (selectedRarity === 'epic' && epicPool.length === 0) selectedRarity = 'rare';
				if (selectedRarity === 'rare' && rarePool.length === 0) selectedRarity = 'common';

				if (selectedRarity === 'common') {
					let roll = Math.random() * totalCommonWeight;
					let cat = roll < weights.atk ? 'atk' : (roll < weights.atk + weights.def ? 'def' : 'util');
					if (cat === 'atk') specificCard = Math.random() > 0.5 ? 'h_attack' : 'l_attack';
					else if (cat === 'def') specificCard = Math.random() > 0.5 ? 'h_block' : 'l_block';
					else specificCard = 'build';
				} else {
					let pool = (selectedRarity === 'rare') ? rarePool : (selectedRarity === 'epic' ? epicPool : legPool);
					specificCard = pool[Math.floor(Math.random() * pool.length)];
				}
			}

			lootedCards.push(specificCard);
			
			// Note: The "New Unlocks" logic was removed from here so it doesn't block the UI!
			this.career.cardCollection[specificCard] = (this.career.cardCollection[specificCard] || 0) + 1;
		}
		
		const allCardTypes = Object.keys(this.RESOURCE_CARDS);
		const ownedTypes = Object.keys(this.career.cardCollection);
		if (allCardTypes.every(type => ownedTypes.includes(type))) {
			this.unlockAchievement('makimono');
		}
		
		this.saveCareer();
		this.pendingMatchLoot = lootedCards;
	},

	renderLootUI: function(cards, customTitle) {
		// 1. THE BULLETPROOF ATTACHMENT
		// We attach to the body so it's NEVER hidden by a parent overlay's "display: none"
		const parentEl = document.body;
		
		let oldContainer = document.getElementById('loot-container');
			if (oldContainer) {
				oldContainer.remove(); 
			}

		// Create a completely fresh container every single time
		let container = document.createElement('div');
		container.id = 'loot-container';
		document.body.appendChild(container);
		
		// Safety check: if cards is null or undefined, stop here
		if (!cards) return;

		// 2. DE-DUPLICATION LOGIC
		const lootCounts = {};
		cards.forEach(key => {
			lootCounts[key] = (lootCounts[key] || 0) + 1;
		});
		const uniqueCards = Object.keys(lootCounts);

		// Reset container for the new swoop
		const title = customTitle || 'KENSHŌ 見性';
		container.innerHTML = `<div class="loot-title">${title}</div>`;
		container.classList.remove('slide-out'); 

		// 3. DYNAMIC ICON PREP
		let attackMoves = this.playerLoadout && this.playerLoadout.length >= 4 ? this.playerLoadout : ['strike', 'sweep', 'thrust', 'throw'];
		let highAttacks = []; 
		let lowAttacks = [];
		attackMoves.forEach(m => {
			if (MOVES[m]) {
				if (MOVES[m].type.includes('high')) highAttacks.push(m);
				else if (MOVES[m].type.includes('low')) lowAttacks.push(m);
			}
		});

		// 4. RENDER UNIQUE LOOT CARDS (OR ASH)
		if (cards.length === 0) {
			// --- RENDER ASH CARD ---
			let cardEl = document.createElement('div');
			cardEl.className = `loot-card-wrapper rarity-common`;
			cardEl.style.animationDelay = `0.5s`; 
			
			const ashSVG = `
				<svg viewBox="0 0 100 100" style="width: 70%; height: 70%; filter: drop-shadow(0px 2px 1px rgba(0,0,0,0.8));">
					<path d="M45 50 Q50 30 55 10" stroke="#555" stroke-width="3" fill="none" stroke-dasharray="4,4" opacity="0.6"/>
					<path d="M20 80 Q50 50 80 80 Z" fill="#333"/>
					<path d="M30 85 Q50 65 70 85 Z" fill="#1a1a1a"/>
					<circle cx="40" cy="72" r="3" fill="#e74c3c" opacity="0.8"/>
					<circle cx="60" cy="76" r="2" fill="#e74c3c" opacity="0.5"/>
					<circle cx="50" cy="68" r="4" fill="#e74c3c" opacity="0.9"/>
				</svg>
			`;

			cardEl.innerHTML = `
				<div class="activity-card" style="filter: grayscale(0.7) contrast(1.2); opacity: 0.95; transform: rotate(4deg) scale(0.95);">
					<div class="card-body" style="background-color: #151515; border: 2px solid #000;">
						<div class="card-inner" style="background-color: #2a2a2a; border: 1px dashed #666;">
							<div class="card-icons icon-layout-1" style="display: flex; justify-content: center; align-items: center;">
								${ashSVG}
							</div>
							<div class="activity-desc" style="color: #aaa; font-style: italic; font-size: 0.35rem; padding-top: 6px; text-shadow: 1px 1px 2px #000;">
								Only embers remain.
							</div>
							<div class="activity-type" style="color: #bdc3c7; text-decoration: line-through; text-decoration-color: #c0392b; letter-spacing: 4px; font-weight: 900; text-shadow: 2px 2px 4px rgba(0,0,0,0.9);">
								ASH
							</div>
						</div>
					</div>
				</div>
			`;
			container.appendChild(cardEl);
			
			setTimeout(() => {
				if (typeof sound !== 'undefined') sound.play('whiff', -0.7);
			}, 500);

		} else {
			// --- RENDER LOOT CARDS ---
			uniqueCards.forEach((cardKey, index) => {
				const count = lootCounts[cardKey];
				
				// --- THE FIX: FLAG NEW CARDS *DURING* RENDER ---
				// If the total amount of this card in your collection exactly equals 
				// the amount you just looted, this is the very first time you've received it!
				if (this.career && this.career.cardCollection && this.career.cardCollection[cardKey] === count) {
					if (!this.unseenItemIds) this.unseenItemIds = new Set();
					this.unseenItemIds.add(cardKey);
					
					if (!this.newUnlocksByCategory) this.newUnlocksByCategory = {};
					this.newUnlocksByCategory.deck = true; 
					this.hasNewUnlocks = true;
					
					// Silently light up the stable background tabs 
					if (typeof this.updateStableNotification === 'function') this.updateStableNotification();
					if (typeof this.updateTabIndicators === 'function') this.updateTabIndicators();
				}
				// -----------------------------------------------

				let cardData = this.RESOURCE_CARDS[cardKey] || { name: 'Unknown', desc: '', type: '?' };
				
				let themeClass = cardData.theme || 'theme-build';
				let layoutClass = cardData.layout || 'icon-layout-1';
				let typeText = cardData.shortName || cardKey.replace('_', ' ').toUpperCase();
				let cardIconsHTML = '';

				if (cardData.isDynamicIcon) {
					const missingX = `<div class="card-icon-slot"><svg viewBox="0 0 24 24" stroke="var(--accent-red)" stroke-width="3" fill="none" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg></div>`;
					if (cardKey === 'h_attack') {
						if (highAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
						else { layoutClass = `icon-layout-${Math.min(highAttacks.length, 4)}`; highAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
					} else if (cardKey === 'l_attack') {
						if (lowAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
						else { layoutClass = `icon-layout-${Math.min(lowAttacks.length, 4)}`; lowAttacks.forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); }
					} else if (cardKey === 'w_attack') {
						// --- THE FIX: ADDED TO LOOT UI ---
						// Combines both arrays and draws up to 4 icons for the wildcard
						const allAttacks = [...highAttacks, ...lowAttacks];
						if (allAttacks.length === 0) { layoutClass = 'icon-layout-0'; cardIconsHTML = missingX; } 
						else { 
							layoutClass = `icon-layout-${Math.min(allAttacks.length, 4)}`; 
							allAttacks.slice(0, 4).forEach(m => { cardIconsHTML += `<div class="card-icon-slot">${MOVE_ICONS[m]}</div>`; }); 
						}
					}
				} else if (cardData.svg) {
					cardIconsHTML = cardData.svg;
				} else if (cardData.iconKey) {
					cardIconsHTML = `<div class="card-icon-slot">${MOVE_ICONS[cardData.iconKey] || '?'}</div>`;
				}

				const multiplierHTML = count > 1 ? `<div class="loot-multiplier">×${count}</div>` : '';

				let cardEl = document.createElement('div');
				let rarityClass = cardData.rarity ? `rarity-${cardData.rarity}` : 'rarity-common';
				cardEl.className = `loot-card-wrapper ${rarityClass}`;
				cardEl.style.animationDelay = `${(index * 0.3) + 0.5}s`; 

				cardEl.innerHTML = `
					${multiplierHTML}
					<div class="activity-card">
						<div class="card-body ${themeClass}">
							<div class="card-inner">
								<div class="card-icons ${layoutClass}">${cardIconsHTML}</div>
								<div class="activity-desc">${cardData.desc}</div>
								<div class="activity-type">${typeText}</div>
							</div>
						</div>
					</div>
				`;
				
				container.appendChild(cardEl);
				
				setTimeout(() => {
					if (typeof sound !== 'undefined') sound.play('card_flick', -0.7);
				}, ((index * 0.3) + 0.5) * 1000);
			});
			
			// --- THE SIMPLIFIED QUICK-ACCESS DECK ICON BUTTON ---
			const deckBtn = document.createElement('button');
			deckBtn.className = 'loot-deck-btn';
			deckBtn.style.cssText = `
				/* 1. FLEX LAYOUT positions this as a centered item within the main container's column */
				margin-top: 20px;
				align-self: center; /* Explicitly centered */
				
				/* 2. THE GHOST FIX: Make only the button area clickable! */
				pointer-events: auto;
				
				/* 3. SIMPLIFIED VISUALS: transparent button area, no background/border, no words */
				background: none;
				border: none;
				padding: 0;
				width: 60px; /* Transparent clickable width */
				height: 60px; /* Transparent clickable height */
				cursor: pointer;
				display: flex;
				justify-content: center;
				align-items: center;
				transition: transform 0.2s;
				outline: none;
				
				/* 4. THE KEYFRAME FIX: Use your existing CSS popInLoot with delay for entry */
				opacity: 0;
				animation: popInLoot 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards 1.5s; 
			`;
			
			// Completely removed the text div, kept *only* the SVG icon (layered cards)
			// Added class 'loot-deck-icon' for CSS styling
			deckBtn.innerHTML = `
				<svg viewBox="0 0 100 100" class="loot-deck-icon">
					<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#2c2c2c" stroke="#555" stroke-width="4" transform="translate(15, -5) rotate(15 50 50)"/>
					<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#4a3728" stroke="#888" stroke-width="4" transform="translate(0, 0) rotate(0 50 50)"/>
					<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#f4ecd8" stroke="#d4af37" stroke-width="4" transform="translate(-15, 5) rotate(-15 50 50)"/>
				</svg>
			`;

			// Simplified hover effects: subtle scale and translateY, no shadow changes
			deckBtn.onmouseover = () => { deckBtn.style.transform = 'scale(1.05) translateY(-2px)'; };
			deckBtn.onmouseout = () => { deckBtn.style.transform = 'scale(1)'; };

			// The auto-slide out timer
			let autoCloseTimer = setTimeout(() => {
				container.classList.add('slide-out');
			}, 6000); // Extended slightly to give them time to notice the deck button

			this.attachSmartClick(deckBtn, () => {
				if (typeof sound !== 'undefined') sound.play('click');
				
				// 1. FREEZE THE TIMER: Stop the loot screen from destroying itself
				clearTimeout(autoCloseTimer);
				
				// 2. Hide the loot screen so it doesn't clutter the background behind the Deck Builder
				container.style.animation = 'none'; 
				container.style.opacity = '0'; 
				container.style.visibility = 'hidden';
				container.style.zIndex = '0'; // Lower it so it can't block the Deck Builder
				
				// 3. Open Deck Builder with our new context flag
				this.openDeckBuilder('loot');
			});

			container.appendChild(deckBtn);
		}
	},

    rematch: function() {
        const stage = document.getElementById('promotion-stage');
        if (stage) stage.innerHTML = '';
        
        // --- CLEANUP HERE ---
        const heyaBtn = document.getElementById('global-heya-btn');
        if (heyaBtn) heyaBtn.classList.remove('slide-in-bottom-left');
        
        // 1. Force the dead bodies to stand up
        this.resetAvatars(true); 

        // 2. Remove the cinematic darkness and screen tear from the board
        const board = document.getElementById('game-board');
        board.classList.remove('cinematic-fatal', 'screen-tear');
        
        const btn = document.getElementById('btn-post-action');

        // 1. Online Mode
        if (this.mode === 'online') {
            // --- RE-QUEUE LOGIC ---
            if (!net.matchId) {
                // --- NEW: Force the post-match screen to hide! ---
                document.body.classList.remove('game-over-active');
                document.getElementById('post-match-overlay').classList.add('hidden');

                if (!net.matchRules.isCasual) {
                    if (typeof this.backToTitle === 'function') this.backToTitle();
                    setTimeout(() => {
                        const onlineMenu = document.getElementById('online-menu');
                        if (onlineMenu) onlineMenu.classList.remove('hidden');

                        document.getElementById('mm-max-build').value = net.matchRules.maxBuild !== undefined ? net.matchRules.maxBuild : 4;
                        document.getElementById('mm-skill-limit').checked = net.matchRules.skillLimit || false;
                        document.getElementById('mm-blitz-mode').checked = net.matchRules.isBlitz || false;
                        
                        net.findMatch();
                    }, 50);
                } else {
                    alert("The private lobby has been closed.");
                    if (typeof this.backToTitle === 'function') this.backToTitle();
                }
                return;
            }

            // --- THE HOLDING PATTERN ---
            if (btn) {
                btn.innerText = "REQUESTED...";
                btn.disabled = true; // Lock the button so they can't spam it
            }
            net.prepareRematch(); 
            // Notice we return here WITHOUT hiding the post-match screen!
            return;
        }

        // --- NON-ONLINE MODES (CPU/Local) ---
        // For offline modes, we instantly tear down the UI and continue
        document.body.classList.remove('game-over-active');
        document.getElementById('post-match-overlay').classList.add('hidden');
        if (btn) btn.disabled = false; // Failsafe reset

        // 2. Career Mode (Active Basho)
        if (this.mode === 'cpu' && this.career.activeBasho) {
            this.startBasho(this.career.activeBasho.div);
            return;
        }

        // 3. Local / Standard CPU (Quick Play)
        if (this.mode === 'local') {
            this.startLocal();
        } else if (this.mode === 'cpu') {
            this.startCPU(this.cpuDiff);
        } else {
             this.startLocal(); // Fallback
        }
    },
	
	skipTutorial: function() {
		sound.play('click');
		
		// 1. Permanently mark as visited so they don't see it again on reload
		localStorage.setItem('sumo_has_visited', 'true');
		
		// 2. Reset Tutorial state
		this.isTutorial = false;
		this.tutorialStep = 0;
		this.isCinematicActive = false;
		
		// 3. Hide the skip button
		const skipBtn = document.getElementById('skip-tutorial-btn');
		if (skipBtn) skipBtn.classList.add('hidden');
		
		const hpTrack = document.getElementById('p1-hp-bar').parentElement;
		const momTrack = document.getElementById('p1-mom-track');
		
		// Stop pulsing any UI elements
		hpTrack.classList.remove('pulse-ui');
		momTrack.classList.remove('pulse-ui');
		
		// 4. Clean up any tutorial-specific UI artifacts
		const overlay = document.getElementById('tutorial-overlay');
		if (overlay) overlay.classList.add('hidden');
		
		const controls = document.getElementById('controls');
		if (controls) controls.innerHTML = '';

		// --- THE FIX: WIPE THE FLOATING CARDS ---
		const myCards = document.getElementById('activity-card-container');
		if (myCards) myCards.innerHTML = '';
		
		const oppCards = document.getElementById('opponent-card-container');
		if (oppCards) oppCards.innerHTML = '';
		// ----------------------------------------
		
		// 5. Bail to main menu
		this.exitToMenu();
		
		console.log("Tutorial skipped by user. Returning to stable.");
	},

    exitToMenu: function() {
		const stage = document.getElementById('promotion-stage');
		if (stage) stage.innerHTML = '';
		
		// --- CLEANUP HERE ---
		const heyaBtn = document.getElementById('global-heya-btn');
		if (heyaBtn) heyaBtn.classList.remove('slide-in-bottom-left');
		
		const board = document.getElementById('game-board');
		board.classList.remove('cinematic-fatal', 'screen-tear');
		document.body.classList.remove('hit-stop', 'game-over-active');
		
		game.resetAvatars(true);
		//BackgroundManager.hide(); // <-- NEW: Hide background on menu
		
		localStorage.removeItem('sumo_rage_quit_guard');
		
		document.body.classList.remove('game-over-active');
		const skipBtn = document.getElementById('skip-tutorial-btn');
		if (skipBtn) skipBtn.classList.add('hidden'); // Always hide on exit

		if (this.mode === 'online') {
			net.reset();
		}
		if (this.crowdTimer) clearTimeout(this.crowdTimer);
		this.mode = 'menu';
		this.hideOverlays();
		document.getElementById('title-screen').classList.remove('hidden');
		if (heyaBtn) heyaBtn.classList.remove('hidden');
		
        if (this.music) {
            this.music.stopMatchDrums();
            this.music.startAmbient();
        }
	},
    
    updateMatchStats: function(p1Wins, p2Wins) {
		// 1. DEFINE WINNER GLOBALLY FOR THIS FUNCTION
		let iWon = false;
		if (this.mode === 'online') {
			const amHost = net.side === 'host';
			iWon = (amHost && p1Wins) || (!amHost && p2Wins);
		} else {
			iWon = !!p1Wins; 
		}

		const isDraw = !p1Wins && !p2Wins;

		// 2. UPDATE PLAY COUNTS & WIN STREAKS
		if (this.mode === 'local') {
			this.career.quickPlay.local.played++;
			if (p1Wins) this.career.quickPlay.local.wins++;
		}
		else if (this.mode === 'cpu') {
			// THE FIX: Standardize tracking key to 'div_X' so it aligns with your initialization
			const key = `div_${this.cpuDiff}`;
			if (!this.career.quickPlay[key]) {
				this.career.quickPlay[key] = { wins: 0, played: 0 };
			}
			this.career.quickPlay[key].played++;
			if (p1Wins) this.career.quickPlay[key].wins++;
			
			this.stats[`${key}_played`] = (this.stats[`${key}_played`] || 0) + 1;
		} else if (this.mode === 'online') {
            
            // --- CASUAL MATCH CHECK ---
            const isCasualMatch = net.matchRules && net.matchRules.isCasual;
            if (isCasualMatch) {
                this.career.quickPlay.online.played++; 
                this.log(`<span style="color:#aaa">Casual Match: No Hōshōkin exchanged.</span>`);
                return; // Skip the rest of the online payout logic completely
            }

            this.career.quickPlay.online.played++;
            const amHost = net.side === 'host';
            const myHosho = this.career.hosho_kin;
            const opHosho = net.opponentHosho !== undefined ? net.opponentHosho : 0; 

            // Define who is who in the UI
            const myPlayerNum = amHost ? 1 : 2;
            const opPlayerNum = amHost ? 2 : 1;

            // Calculate point difference (positive if they are higher rank)
            const gap = opHosho - myHosho; 

            if (iWon) {
                this.career.quickPlay.online.wins++;
                this.onlineStreak++;
                this.career.stats.loss_streak = 0; 

                if (this.onlineStreak >= 3) this.unlockAchievement('rensho');
                if (opHosho >= 2000) this.unlockAchievement('kinboshi');
                const myPlayer = amHost ? this.p1 : this.p2;
                if (myPlayer.hp === myPlayer.maxHp) this.unlockAchievement('zensho');
                if (this.matchStats.rounds >= 20) this.unlockAchievement('mizu_iri');

                // 1. Calculate my dynamic gain (Base 50 + 15% Underdog Bonus)
                let winnerGain = 50 + Math.max(0, Math.floor(gap * 0.15)); 

                // 2. Calculate opponent's loss with 500-point Tier Floor protection
                let loserLoss = 25;
                const opFloor = Math.floor(opHosho / 500) * 500;
                if (opHosho - loserLoss < opFloor) {
                    loserLoss = Math.max(0, opHosho - opFloor);
                }

                this.career.hosho_kin += winnerGain;
				this.career.stats.hoshoHistory.push(this.career.hosho_kin); // <-- RECORD THE GAIN
                this.log(`<span style="color:var(--gold)">Victory Reward: +${winnerGain}¥ Hōshōkin</span>`);
				
				if (net.opponentHosho !== undefined) net.opponentHosho -= loserLoss;
                
                setTimeout(() => {
                    // Pass exactly who won/lost and their distinct amounts
                    this.animateHoshoTransfer(myPlayerNum, opPlayerNum, winnerGain, loserLoss);
                }, 500);

            } else if (!isDraw) {
                this.onlineStreak = 0;

                // 1. Calculate opponent's dynamic gain (Base 50 + 15% Underdog Bonus)
                let winnerGain = 50 + Math.max(0, Math.floor(-gap * 0.15));

                // 2. Calculate my loss with 500-point Tier Floor protection
                let loserLoss = 25;
                const myFloor = Math.floor(myHosho / 500) * 500;
                if (myHosho - loserLoss < myFloor) {
                    loserLoss = Math.max(0, myHosho - myFloor);
                }

                this.career.hosho_kin -= loserLoss;
				this.career.stats.hoshoHistory.push(this.career.hosho_kin);
                this.log(`<span style="color:var(--accent-red)">Defeat: -${loserLoss}¥ Hōshōkin</span>`);
				
				if (net.opponentHosho !== undefined) net.opponentHosho += winnerGain;
                
                setTimeout(() => {
                    // Pass exactly who won/lost and their distinct amounts
                    this.animateHoshoTransfer(opPlayerNum, myPlayerNum, winnerGain, loserLoss); 
                }, 500);
            }
        }

		// 3. UPDATE LOSS STREAK FOR NON-ONLINE MODES
		if (!iWon && !isDraw) {
			this.career.stats.loss_streak = (this.career.stats.loss_streak || 0) + 1;
		} else if (iWon) {
			this.career.stats.loss_streak = 0;
		}

		// 4. COMMIT STYLE POINTS
		this.career.style.success.b += this.sessionStats.s_b;
		this.career.style.total.b += this.sessionStats.t_b;
		this.career.style.success.a += this.sessionStats.s_a;
		this.career.style.total.a += this.sessionStats.t_a;
		this.career.style.success.d += this.sessionStats.s_d;
		this.career.style.total.d += this.sessionStats.t_d;
		
		// 5. RUN PROGRESSIVE CHECKS
		this.checkProgressiveAchievements(iWon);
		
		// --- NEW: ICE DOHYO ACHIEVEMENT CHECK ---
		if (this.career && this.career.hosho_kin >= 2000) {
            this.unlockAchievement('hosho_2000');
        }
		
		// 6. SAVE
		this.saveCareer();
		this.saveStats(); 
	},

	animateHoshoTransfer: function(winnerPNum, loserPNum, winnerGain, loserLoss) {
        const fromEl = document.getElementById(`p${loserPNum}-hosho-disp`);
        const toEl = document.getElementById(`p${winnerPNum}-hosho-disp`);

        if (!fromEl || !toEl || typeof vfx === 'undefined') return;

        const toRect = toEl.getBoundingClientRect();
        
        const startX = window.innerWidth / 2;
        const startY = window.innerHeight * 0.55; 
        
        const endX = toRect.left + (toRect.width / 2);
        const endY = toRect.top + (toRect.height / 2);

        const burstCount = Math.min(40, Math.max(10, Math.floor(loserLoss / 10)));
        
        for(let i = 0; i < burstCount; i++) {
            const angle = Math.random() * Math.PI * 2; 
            const speed = 30 + Math.random() * 30;     
            
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            
            const spin = (Math.random() - 0.5) * 0.8;
            const size = 12 + Math.random() * 6; 
            
            // --- INCREASED HANG TIME ---
            // Base delay of 60 frames (~1 sec), plus up to 80 frames random variance
            const hoverDelay = 60 + Math.random() * 80; 
            
            vfx.emitHoming(
                startX, startY, vx, vy, size, 
                1, 1, 1, 1.0, 1000, 
                Math.random() * Math.PI, spin, 7.0, 
                endX, endY, hoverDelay
            );
        }

        if (typeof sound !== 'undefined') sound.play('click'); 
        
        let loseStart = parseInt(fromEl.innerText.replace(/\D/g,'')) || 0;
        let winStart = parseInt(toEl.innerText.replace(/\D/g,'')) || 0;
        
        // --- INCREASED TEXT DELAY ---
        // Wait 1.8 seconds so the text starts ticking right as the first coins land
        setTimeout(() => {
            let ticks = 0;
            const maxTicks = 25; 
            
            let soundTick = setInterval(() => {
                if (typeof sound !== 'undefined') sound.play('click');
            }, 80);

            const tickInterval = setInterval(() => {
                ticks++;
                const curLose = Math.round(loseStart - (loserLoss * (ticks / maxTicks)));
                const curWin = Math.round(winStart + (winnerGain * (ticks / maxTicks)));
                
                fromEl.innerText = `[${curLose}¥]`;
                toEl.innerText = `[${curWin}¥]`;
                
                if (ticks >= maxTicks) {
                    clearInterval(tickInterval);
                    clearInterval(soundTick);
                }
            }, 30);
        }, 1800);
    },
	
	normalizeGameState: function(player, cpu, matchStats) {
		// CRITICAL: These must match the exact maximums the AI was trained on!
		const GLOBAL_MAX_WILL = 20.0; 
		const MAX_MOMENTUM = 8.0;
		const MAX_MOVE_COST = 4.0; 
		const MAX_MOVE_DMG = 10.0;
		const safeRatio = (n, d) => d > 0 ? (n / d) : 0.0;
		const totalMoves = matchStats.totalBuilds + matchStats.totalDefends + matchStats.totalAttacks;
		
		// LETHAL THREAT SENSOR (Can the opponent end the game right now?)
		let p1HasLethal = 0.0;
		let cpuHasLethal = 0.0;
		player.attacks.forEach(atk => { if (atk && player.momentum >= atk.cost && atk.dmg >= cpu.will) p1HasLethal = 1.0; });
		cpu.attacks.forEach(atk => { if (atk && cpu.momentum >= atk.cost && atk.dmg >= player.will) cpuHasLethal = 1.0; });

		return new Float32Array([
			// Baseline Stats (24)
			safeRatio(player.will, player.maxWill), safeRatio(cpu.will, cpu.maxWill),
			player.maxWill / GLOBAL_MAX_WILL, cpu.maxWill / GLOBAL_MAX_WILL,
			player.momentum / MAX_MOMENTUM, cpu.momentum / MAX_MOMENTUM,
			player.hasIronWall ? 1.0 : 0.0, cpu.hasIronWall ? 1.0 : 0.0,
			
			// Dynamic loadout ratio (safely scales if they have 4 or 5 moves)
			(player.attacks.filter(a => a && a.height === 'high').length / player.attacks.length) || 0,
			(cpu.attacks.filter(a => a && a.height === 'high').length / cpu.attacks.length) || 0,
			
			// Toolbelt Awareness - Costs (Padded safely to 5 slots)
			(player.attacks[0]?.cost || 0) / MAX_MOVE_COST, (player.attacks[1]?.cost || 0) / MAX_MOVE_COST,
			(player.attacks[2]?.cost || 0) / MAX_MOVE_COST, (player.attacks[3]?.cost || 0) / MAX_MOVE_COST,
			(player.attacks[4]?.cost || 0) / MAX_MOVE_COST, 
			
			(cpu.attacks[0]?.cost || 0) / MAX_MOVE_COST, (cpu.attacks[1]?.cost || 0) / MAX_MOVE_COST,
			(cpu.attacks[2]?.cost || 0) / MAX_MOVE_COST, (cpu.attacks[3]?.cost || 0) / MAX_MOVE_COST,
			(cpu.attacks[4]?.cost || 0) / MAX_MOVE_COST, 
			
			safeRatio(matchStats.totalBuilds, totalMoves), safeRatio(matchStats.totalDefends, totalMoves),
			safeRatio(matchStats.totalAttacks, totalMoves), safeRatio(matchStats.successBuilds, matchStats.totalBuilds),
			safeRatio(matchStats.successDefends, matchStats.totalDefends), safeRatio(matchStats.successAttacks, matchStats.totalAttacks),
			
			// Deep Memory (Now accounts for 5 indices per player)
			(player.lastActionIndex || 0) / 7.0, 
			(player.lastActionIndex2 || 0) / 7.0, 
			(player.lastActionIndex3 || 0) / 7.0, 
			(player.lastActionIndex4 || 0) / 7.0, 
			(player.lastActionIndex5 || 0) / 7.0, 
			(cpu.lastActionIndex || 0) / 7.0,
			(cpu.lastActionIndex2 || 0) / 7.0,
			(cpu.lastActionIndex3 || 0) / 7.0,
			(cpu.lastActionIndex4 || 0) / 7.0,    
			(cpu.lastActionIndex5 || 0) / 7.0,    
			
			// Toolbelt Awareness - Damage Inputs (Padded safely to 5 slots)
			(player.attacks[0]?.dmg || 0) / MAX_MOVE_DMG, (player.attacks[1]?.dmg || 0) / MAX_MOVE_DMG,
			(player.attacks[2]?.dmg || 0) / MAX_MOVE_DMG, (player.attacks[3]?.dmg || 0) / MAX_MOVE_DMG,
			(player.attacks[4]?.dmg || 0) / MAX_MOVE_DMG, 
			
			(cpu.attacks[0]?.dmg || 0) / MAX_MOVE_DMG, (cpu.attacks[1]?.dmg || 0) / MAX_MOVE_DMG,
			(cpu.attacks[2]?.dmg || 0) / MAX_MOVE_DMG, (cpu.attacks[3]?.dmg || 0) / MAX_MOVE_DMG,
			(cpu.attacks[4]?.dmg || 0) / MAX_MOVE_DMG, 
			
			// Live Tendency Profiling (4)
			safeRatio(player.highUsed || 0, player.totalAtks || 0),
			safeRatio(player.lowUsed || 0, player.totalAtks || 0),
			safeRatio(cpu.highUsed || 0, cpu.totalAtks || 0),
			safeRatio(cpu.lowUsed || 0, cpu.totalAtks || 0),
			
			// The Threat Sensor (2)
			p1HasLethal,
			cpuHasLethal
		].map(val => isNaN(val) ? 0 : val));
	},
	
	updateBrainVisualizer: function(rawOutputs, cpuData) {
		// 1. Create the HUD AND SLIDER if it doesn't exist yet
		let debugUI = document.getElementById('brain-debug');
		if (!debugUI) {
			debugUI = document.createElement('div');
			debugUI.id = 'brain-debug';
			
			debugUI.style.cssText = `
				position: fixed; top: 20px; right: 20px; width: 220px;
				background: rgba(20, 20, 20, 0.85); color: #fff; font-family: monospace;
				padding: 15px; border-radius: 8px; border: 1px solid #444;
				z-index: 9999; font-size: 12px; pointer-events: auto; 
				box-shadow: 0 4px 10px rgba(0,0,0,0.5);
			`;
			
			if (typeof game.currentAITemp === 'undefined') game.currentAITemp = 0.10;

			debugUI.innerHTML = `
				<div id="brain-header" style="margin-bottom:8px; font-weight:bold; color:#f1c40f; text-align:center; border-bottom: 1px solid #555; padding-bottom: 5px; cursor:pointer; user-select:none;">
					▼ AI Q-VALUES
				</div>
				
				<div id="brain-content">
					<div style="margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px;">
						<div style="display:flex; justify-content:space-between; color:#aaa; margin-bottom:4px;">
							<span>Chaos (Temp):</span>
							<span id="temp-display">${game.currentAITemp.toFixed(2)}</span>
						</div>
						<input type="range" id="temp-slider" min="0.01" max="1.0" step="0.01" value="${game.currentAITemp}" style="width:100%; cursor:pointer;">
					</div>
					<div id="brain-bars-container"></div>
				</div>
			`;
			
			document.body.appendChild(debugUI);

			// Toggle Collapse Logic
			const header = document.getElementById('brain-header');
			const content = document.getElementById('brain-content');
			
			header.addEventListener('click', () => {
				const isCollapsed = content.style.display === 'none';
				content.style.display = isCollapsed ? 'block' : 'none';
				header.innerText = isCollapsed ? '▼ AI Q-VALUES' : '▶ AI Q-VALUES';
			});

			// Slider Logic
			document.getElementById('temp-slider').addEventListener('input', (e) => {
				game.currentAITemp = parseFloat(e.target.value);
				document.getElementById('temp-display').innerText = game.currentAITemp.toFixed(2);
			});
		}

		// --- 2. DYNAMICALLY MAP RAW OUTPUTS ---
		const actionMap = [
			{ name: 'Build', val: rawOutputs[0], cost: 0 },
			{ name: 'High Block', val: rawOutputs[1], cost: 0 },
			{ name: 'Low Block', val: rawOutputs[2], cost: 0 }
		];

		// Loop through the attacks the CPU ACTUALLY has (4 or 5)
		const numAttacks = cpuData.attacks ? cpuData.attacks.length : 0;
		for (let i = 0; i < numAttacks; i++) {
			actionMap.push({
				name: MOVES[cpuData.attacks[i]?.id]?.name || `ATK ${i + 1}`,
				val: rawOutputs[3 + i], // Offset by 3 for the base moves
				cost: cpuData.attacks[i]?.cost ?? 99
			});
		}

		// 3. Find the highest value so we can scale the bars
		const maxVal = Math.max(...actionMap.map(a => a.val));

		// 4. Build the HTML ONLY for the bars
		let barsHtml = '';
		
		actionMap.forEach((a) => {
			const canAfford = cpuData.momentum >= a.cost;
			
			const widthPct = maxVal > 0 ? Math.max(0, (a.val / maxVal) * 100) : 0;
			const barColor = !canAfford ? '#555' : (a.val === maxVal ? '#27ae60' : '#d93a3a');
			const textColor = !canAfford ? '#777' : '#ddd';

			barsHtml += `
				<div style="display:flex; justify-content:space-between; margin-top:6px; color:${textColor};">
					<span>${a.name}</span>
					<span>${a.val.toFixed(3)}</span>
				</div>
				<div style="width:100%; height:8px; background:#222; border-radius:2px; margin-top:2px; overflow:hidden;">
					<div style="width:${widthPct}%; height:100%; background:${barColor}; transition: width 0.2s ease-out;"></div>
				</div>
			`;
		});

		// 5. Inject the bars into their dedicated container
		document.getElementById('brain-bars-container').innerHTML = barsHtml;
	},

	decodeBrainOutput: function(rawOutputs, cpuData) {
		const actionMap = [
			{ index: 0, id: 'build',      cost: 0 },
			{ index: 1, id: 'h_block',    cost: 0 },
			{ index: 2, id: 'l_block',    cost: 0 },
			{ index: 3, id: cpuData.attacks[0]?.id, cost: cpuData.attacks[0]?.cost ?? 99 },
			{ index: 4, id: cpuData.attacks[1]?.id, cost: cpuData.attacks[1]?.cost ?? 99 },
			{ index: 5, id: cpuData.attacks[2]?.id, cost: cpuData.attacks[2]?.cost ?? 99 },
			{ index: 6, id: cpuData.attacks[3]?.id, cost: cpuData.attacks[3]?.cost ?? 99 },
			// --- NEW 5TH SLOT ---
			{ index: 7, id: cpuData.attacks[4]?.id, cost: cpuData.attacks[4]?.cost ?? 99 }
		];

		let validActions = [];
		let wasMasked = false;

		// 1. Filter out illegal moves (like attacks we can't afford, OR SEALED MOVES)
		for (let i = 0; i < rawOutputs.length; i++) {
			const action = actionMap[i];
			const isSealed = (cpuData.disabledMoves || []).includes(action.id);
			
			if (action.id !== undefined && cpuData.momentum >= action.cost && !isSealed) {
				validActions.push({ ...action, qValue: rawOutputs[i] });
			} else {
				wasMasked = true;
			}
		}

		// Failsafe
		if (validActions.length === 0) return { id: 'build', index: 0, wasMasked: true };

		// 2. Calculate Softmax Probabilities
		// We subtract the max Q-value for mathematical stability so `Math.exp` doesn't blow up
		const maxQ = Math.max(...validActions.map(a => a.qValue));
		
		let weightSum = 0;
		const currentTemp = this.currentAITemp || 0.10; // Fallback if undefined
		validActions.forEach(a => {
			// The Temperature variable controls the "chaos"
			a.weight = Math.exp((a.qValue - maxQ) / currentTemp);
			weightSum += a.weight;
		});

		// 3. Spin the Roulette Wheel!
		let roll = Math.random() * weightSum;
		let selectedAction = validActions[0];
		
		for (let a of validActions) {
			roll -= a.weight;
			if (roll <= 0) {
				selectedAction = a;
				break;
			}
		}

		return { id: selectedAction.id, index: selectedAction.index, wasMasked };
	},

    getCPUMove: async function() {
		const p1 = this.p1;
		const p2 = this.p2;

		const diff = this.cpuDiff !== undefined ? Math.max(0, Math.min(5, this.cpuDiff)) : 0;
		const optimalChance = [0.30, 0.45, 0.60, 0.75, 0.85, 0.95][diff];

		let loopCount = 0;
		while (p2.hand && p2.hand.length > 0 && !(p2.cyclePenalty > 0) && (p2.bankedCycles || 0) > 0 && loopCount < 5) {
			
			// --- 1. DETAILED HOLD EVALUATION ---
			let valuableHolds = new Set();
			let playerHasGuardBreak = this.playerLoadout?.some(id => MOVES[id]?.type.includes('break') || MOVES[id]?.desc?.toLowerCase().includes('break'));
			
			// Does the CPU have half of the legendary seal?
			const hasAGyo = p2.hand.some(c => c.type === 'a_gyo');
			const hasUnGyo = p2.hand.some(c => c.type === 'un_gyo');

			p2.hand.forEach((c, index) => {
				let shouldHold = false;
				
				switch(c.type) {
					case 'suri_ashi':
					case 'hassotobi':
						if (p2.hp < p2.maxHp) shouldHold = true; // Protect healing if hurt
						break;
					case 'kimedashi':
						if (p2.streak > 0 || p1.mom >= 3) shouldHold = true; // Protect streak or heavy defense
						break;
					case 'soppugata':
						if (p2.hp <= p2.maxHp - 2 || p1.mom >= 2) shouldHold = true; // Recoil is best when pressured
						break;
					case 'mawashi_grip':
						if (playerHasGuardBreak) shouldHold = true; // Anti-meta protection
						break;
					case 'a_gyo':
					case 'un_gyo':
						shouldHold = true; // Never toss a piece of the ultimate seal
						break;
				}

				if (shouldHold && Math.random() < optimalChance) {
					valuableHolds.add(index);
				}
			});

			// --- 2. MULTI-TIER PRIORITY SEARCH ---
			let bestTarget = -1;

			// Priority 1: Sabotage. Freeze or reset the player if they are getting too strong.
			if ((p1.bankedCycles || 0) >= 2 || p1.mom >= 3 || p1.hand.length >= 4) {
				bestTarget = p2.hand.findIndex(c => c.type === 'nekodamashi');
				
				// If they don't have Neko, but they do have Shikiri, blow the player's hand away!
				if (bestTarget === -1) {
					bestTarget = p2.hand.findIndex(c => c.type === 'shikiri_naoshi');
				}
			}

			// PRIORITY 2: STARVATION OR SEAL HUNTING (Osoji / Chankonabe)
			if (bestTarget === -1) {
				const hasCommons = p2.hand.some(c => ['build', 'h_attack', 'l_attack', 'h_block', 'l_block'].includes(c.type));
				const huntingSeal = (hasAGyo && !hasUnGyo) || (hasUnGyo && !hasAGyo);
				
				// If starved of moves OR missing a seal piece, use redraw/draw cards
				if (!hasCommons || huntingSeal) {
					bestTarget = p2.hand.findIndex(c => c.type === 'osoji');
					if (bestTarget === -1) bestTarget = p2.hand.findIndex(c => c.type === 'chankonabe');
				}
			}

			// PRIORITY 3: REFILL (Chankonabe)
			// If hand size is low, draw more cards regardless of starvation
			if (bestTarget === -1 && p2.hand.length <= 3) {
				bestTarget = p2.hand.findIndex(c => c.type === 'chankonabe');
			}

			// PRIORITY 4: ECONOMY (Waki Ga Katai)
			if (bestTarget === -1) {
				bestTarget = p2.hand.findIndex(c => c.type === 'waki_ga_katai');
			}

			// PRIORITY 5: TRASH MANAGEMENT (Useless Holds)
			if (bestTarget === -1 && p2.hand.length >= 4) {
				bestTarget = p2.hand.findIndex((c, idx) => {
					const data = this.RESOURCE_CARDS[c.type];
					return data?.desc?.includes('Hold:') && !valuableHolds.has(idx);
				});
			}

			// --- 3. BLUNDER & EXECUTION ---
			let discardTarget = -1;
			
			// FUMBLE SAFETY NET: If the CPU panics, try not to throw away its ONLY copy of a common card!
			let safeBlunderPool = [];
			p2.hand.forEach((c, i) => {
				const isCommon = ['build', 'h_attack', 'l_attack', 'h_block', 'l_block'].includes(c.type);
				const countInHand = p2.hand.filter(card => card.type === c.type).length;
				if (!isCommon || countInHand > 1) safeBlunderPool.push(i);
			});
			// If somehow every card is a single common, just pick randomly
			if (safeBlunderPool.length === 0) safeBlunderPool = [Math.floor(Math.random() * p2.hand.length)];

			if (bestTarget !== -1) {
				if (Math.random() < optimalChance) {
					discardTarget = bestTarget; // Perfect Execution
				} else {
					// BLUNDER: The CPU misses the smart play!
					console.log(`[CPU Strategy] Tier ${diff} AI missed the optimal play!`);
					if (Math.random() < 0.5) {
						discardTarget = safeBlunderPool[Math.floor(Math.random() * safeBlunderPool.length)];
					} else {
						break; // CPU just freezes and ends its phase
					}
				}
			} else {
				// CHAOS: Low-level CPUs might just click things out of boredom
				if (Math.random() < (1.0 - optimalChance) && Math.random() < 0.20) {
					console.log(`[CPU Strategy] Tier ${diff} AI made a chaotic discard!`);
					discardTarget = safeBlunderPool[Math.floor(Math.random() * safeBlunderPool.length)];
				}
			}

			if (discardTarget !== -1) {
				if (typeof this.cycleOpponentCard === 'function') {
					// We just await the function itself now!
					await this.cycleOpponentCard(2, discardTarget); 
				}
				loopCount++;
			} else {
				break; 
			}
		} // <-- End of the while loop

		// --- THE GRANDMASTER AI (Standard Gameplay) ---
		if (this.isAiReady) {
			const p1Attacks = this.playerLoadout.map(id => { return { ...MOVES[id], id: id }; });
			const p2Attacks = this.cpuLoadout.map(id => { return { ...MOVES[id], id: id }; });

			const p1HighRatio = p1Attacks.filter(m => m.type === 'atk_high').length / (p1Attacks.length || 1);
			const p2HighRatio = p2Attacks.filter(m => m.type === 'atk_high').length / (p2Attacks.length || 1);

			const p1AIState = {
				will: this.p1.hp, maxWill: this.p1.maxHp, momentum: this.p1.mom,
				hasIronWall: this.p1.streak > 0, highAttackRatio: p1HighRatio,
				attacks: p1Attacks, lastActionIndex: this.p1.lastActionIndex || 0,
				lastActionIndex2: this.p1.lastActionIndex2 || 0, lastActionIndex3: this.p1.lastActionIndex3 || 0,
				lastActionIndex4: this.p1.lastActionIndex4 || 0, lastActionIndex5: this.p1.lastActionIndex5 || 0,
				totalAtks: this.p1.totalAtks || 0, highUsed: this.p1.highUsed || 0, lowUsed: this.p1.lowUsed || 0,
				disabledMoves: this.p1.disabledMoves || []
			};

			const p2AIState = {
				will: this.p2.hp, maxWill: this.p2.maxHp, momentum: this.p2.mom,
				hasIronWall: this.p2.streak > 0, highAttackRatio: p2HighRatio,
				attacks: p2Attacks, lastActionIndex: this.p2.lastActionIndex || 0, 
				lastActionIndex2: this.p2.lastActionIndex2 || 0, lastActionIndex3: this.p2.lastActionIndex3 || 0,
				lastActionIndex4: this.p2.lastActionIndex4 || 0, lastActionIndex5: this.p2.lastActionIndex5 || 0,
				totalAtks: this.p2.totalAtks || 0, highUsed: this.p2.highUsed || 0, lowUsed: this.p2.lowUsed || 0,
				disabledMoves: this.p2.disabledMoves || []
			};

			const brainInputs = this.normalizeGameState(p1AIState, p2AIState, this.matchStats);
			
			const rawOutputs = await new Promise(resolve => {
				this.pendingAiResolve = resolve;
				this.aiWorker.postMessage({ type: 'RUN', inputs: Array.from(brainInputs) });
			});
			
			const bestMove = this.decodeBrainOutput(rawOutputs, p2AIState);
			let finalMoveId = bestMove.id;

			const p1MoveObj = MOVES[this.p1.move];
			const finalMoveObj = MOVES[finalMoveId];

			const reflexMap = { 'tutorial': 0.00, 0: 0.25, 1: 0.35, 2: 0.55, 3: 0.75, 4: 0.85, 5: 1.00 };
			const reflexChance = reflexMap[this.cpuDiff] || 0.50;
			const rankName = this.DIVISIONS[this.cpuDiff] ? this.DIVISIONS[this.cpuDiff].name.toUpperCase() : "TUTORIAL";

			if (finalMoveId === 'h_block' || finalMoveId === 'l_block') {
				if (p1MoveObj && p1MoveObj.type.includes('atk')) {
					if (Math.random() < reflexChance) {
						const isHighAttack = p1MoveObj.type.includes('high');
						const correctBlock = isHighAttack ? 'h_block' : 'l_block';
						const wrongBlock = isHighAttack ? 'l_block' : 'h_block';

						let affordableHigh = 0;
						let affordableLow = 0;

						this.playerLoadout.forEach(moveId => {
							const m = MOVES[moveId];
							if (m && m.type.includes('atk') && this.p1.mom >= m.cost) {
								if (m.type.includes('high')) affordableHigh++;
								if (m.type.includes('low')) affordableLow++;
							}
						});

						const totalAffordable = affordableHigh + affordableLow;
						const floor = this.cpuDiff >= 4 ? 0.75 : 0.5; 
						let blockChance = floor;

						if (totalAffordable > 0) {
							let weightedRatio = isHighAttack ? (affordableHigh / totalAffordable) : (affordableLow / totalAffordable);
							blockChance = Math.max(floor, weightedRatio);
						}

						if (Math.random() < blockChance) finalMoveId = correctBlock;
						else finalMoveId = wrongBlock;
						console.log(`[AI Block Math] Rank: ${rankName} | Passed Reflex Check! | Chance of Perfect Block: ${Math.round(blockChance * 100)}%`);
					} else {
						console.log(`[AI Block Math] Rank: ${rankName} | Failed Reflex Check. Guessing blindly.`);
					}
				}
			}
			else if (finalMoveObj && finalMoveObj.type.includes('atk')) {
				if (p1MoveObj && p1MoveObj.type.includes('atk')) {
					if (Math.random() < reflexChance) {
						let bestAttackId = finalMoveId; 
						let maxCost = -1;

						this.cpuLoadout.forEach(moveId => {
							const m = MOVES[moveId];
							const isSealed = (this.p2.disabledMoves || []).includes(moveId);
							if (m && m.type.includes('atk') && this.p2.mom >= m.cost && !isSealed) {
								if (m.cost > maxCost) {
									maxCost = m.cost;
									bestAttackId = moveId;
								}
							}
						});

						if (maxCost >= p1MoveObj.cost) {
							finalMoveId = bestAttackId;
							console.log(`[AI Attack Math] Rank: ${rankName} | Passed Reflex Check! Upgraded kimarite.`);
						} else {
							console.log(`[AI Attack Math] Rank: ${rankName} | Passed Reflex Check, lacks momentum.`);
						}
					} else {
						console.log(`[AI Attack Math] Rank: ${rankName} | Failed Reflex Check.`);
					}
				}
			}
			
			return finalMoveId; 
		} 
		
		console.warn("Brain not loaded yet, falling back to Build.");
		return 'build';
	},
	
	generateCPULoadout: function(diff) {
        // 1. Start with the "Always Available" basic moves
        let validPool = ['strike', 'sweep', 'thrust', 'throw']; 
        
        // 2. Add the moves the player has actually unlocked
        if (this.career && this.career.unlockedMoves) {
            this.career.unlockedMoves.forEach(m => {
                if (!validPool.includes(m)) validPool.push(m);
            });
        }

        // 3. Add the "Division Signature"
        const houseMoves = { 0: 'hook', 1: 'crush', 2: 'trip', 3: 'twist', 4: 'nodowa', 5: 'utchari' };
        if (this.career && this.career.activeBasho) {
            const sig = houseMoves[this.career.activeBasho.div];
            if (sig && !validPool.includes(sig)) validPool.push(sig);
        }

        // 4. Filter for only Attacks
        const allowedAttacks = Object.keys(MOVES).filter(k => 
            MOVES[k].type.includes('atk') && validPool.includes(k)
        );

        // 5. TIER SELECTION with "Step-Down" Failsafe
        const getMovesByCost = (c) => allowedAttacks.filter(k => MOVES[k].cost === c);
        
        const t0 = getMovesByCost(0);
        const t1 = getMovesByCost(1);
        const t2 = getMovesByCost(2);
        const t3 = getMovesByCost(3);
        const t4 = getMovesByCost(4);

        const smartPick = (preferred, fallbackPool) => {
            if (preferred.length > 0) return preferred[Math.floor(Math.random() * preferred.length)];
            if (fallbackPool.length > 0) return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
            return allowedAttacks[0]; 
        };

        // --- NEW: Check if the player has unlocked the 5-move Makuuchi threshold ---
        const playerHasKinboshi = !!(this.achievements && this.achievements['kinboshi']);

        let loadout;
        let isValidMix = false;

        // --- Anti-Exploit Generation Loop ---
        do {
            const slot0 = smartPick(t0, allowedAttacks);
            const slot1 = smartPick(t1, t0); 
            const slot2 = smartPick(t2, t1); 
            const slot3 = smartPick(t3, t2); 

            loadout = [slot0, slot1, slot2, slot3];

            // --- NEW: 5th Move Logic ---
            // The Yokozuna ALWAYS gets 5 moves. 
            // Other Makuuchi CPUs (diff === 5) only get 5 moves IF the player has Kinboshi.
            if (this.currentOpponentName === "Yokozuna" || (diff === 5 && playerHasKinboshi)) {
                const slot4 = smartPick(t4.length ? t4 : t3, allowedAttacks);
                loadout.push(slot4);
            }

            // Check if the generated loadout contains at least one of each height
            const hasHigh = loadout.some(m => MOVES[m] && MOVES[m].type.includes('high'));
            const hasLow = loadout.some(m => MOVES[m] && MOVES[m].type.includes('low'));

            isValidMix = hasHigh && hasLow;

        } while (!isValidMix);

        // Sort so the AI (and visual rendering) places cheapest moves first
        loadout.sort((a, b) => MOVES[a].cost - MOVES[b].cost);

        return loadout;
    },
	
	getPlayerActionIndex: function(moveId, isP1 = true) {
		if (moveId === 'build') return 0;
		if (moveId === 'h_block') return 1;
		if (moveId === 'l_block') return 2;

        // Determine which deck to check against
        let targetLoadout = this.playerLoadout;
        if (!isP1) {
            if (this.mode === 'cpu') targetLoadout = this.cpuLoadout || ['strike', 'sweep', 'thrust', 'throw'];
            else if (this.mode === 'online') targetLoadout = net.opponentLoadout || ['strike', 'sweep', 'thrust', 'throw'];
        }

		// Find its position in the correct loadout
		const attackIndex = targetLoadout.indexOf(moveId);
		
		// Add 3 because indices 0, 1, and 2 are reserved for utility/blocks
		if (attackIndex !== -1) {
			return attackIndex + 3; 
		}

		// Fallback
		return 0; 
	},
	
    showRules: () => document.getElementById('rules-overlay').classList.remove('hidden'),
    closeRules: () => document.getElementById('rules-overlay').classList.add('hidden'),
    
	openOnlineMenu: function() {
        this.hideOverlays();
        document.getElementById('title-screen').classList.add('hidden');
        document.getElementById('online-menu').classList.remove('hidden');
        
        // Reset menu state
        document.getElementById('online-main').classList.remove('hidden');
        document.getElementById('online-searching').classList.add('hidden');
    },

    cancelMatchmaking: function() {
        net.reset(); // This safely deletes your Firebase lobby if you were hosting
        this.backToTitle();
    },

	backToTitle: () => {
		game.hideOverlays();
		BackgroundManager.hide(); // <-- NEW: Hide background on title
		document.getElementById('title-screen').classList.remove('hidden');
		
		const board = document.getElementById('game-board');
		board.classList.remove('cinematic-fatal', 'screen-tear');
		document.body.classList.remove('hit-stop', 'game-over-active');
		
		game.mode = 'menu'; // Safety for sudden exit from match.
		game.resetAvatars(true);
		
		const heyaBtn = document.getElementById('global-heya-btn');
		if (heyaBtn) {
			heyaBtn.classList.remove('hidden');
			// Let our centralized logic decide if the "NEW" pulsing should stay or go
			game.updateStableNotification(); 
		}
	},
	
	hardReset: function() {
		if (!confirm("⚠️ HARAKIRI: This will permanently wipe your Rank, Money, Badges, and Loadout. Continue?")) return;

		// 1. Comprehensive list of all keys used in the game
		const keysToWipe = [
			'sumo_career', 
			'sumo_loadout', 
			'sumo_stats', 
			'sumo_achievements', 
			'sumo_cosmetics', 
			'sumo_player_cosmetics',
			'sumo_has_visited', // Resets the tutorial
			'sumo_maegashira_unlock', 
			'sumo_ozeki_unlock', 
			'sumo_yokozuna_unlock'
		];

		// 2. Perform the wipe
		keysToWipe.forEach(key => localStorage.removeItem(key));

		console.log("💥 All Save data deleted. Resetting Dojo...");

		// 3. Small delay to ensure the disk I/O completes before the browser reloads
		setTimeout(() => {
			// Forces a clean reload from the server, ignoring cache
			window.location.href = window.location.pathname; 
		}, 150);
	},
	// 1. Time Freeze: Stops the visual flow for a moment of impact
	hitStop: function(duration) {
		const board = document.getElementById('game-board');
		
		// Using requestAnimationFrame ensures the "pause" starts exactly on a frame render
		requestAnimationFrame(() => {
			board.classList.add('hit-stop-active');
			
			setTimeout(() => {
				board.classList.remove('hit-stop-active');
			}, duration);
		});
	},

	// 2. Screen Shake: Physically jolts the arena
	shakeScreen: function(intensity) {
		const arena = document.querySelector('.arena');
		arena.classList.remove('shake-active');
		void arena.offsetWidth; // Trigger reflow to restart animation
		arena.classList.add('shake-active');
    
		// Intensity could be used to swap between 'light-shake' or 'heavy-shake' classes
		setTimeout(() => {
			arena.classList.remove('shake-active');
		}, 300);
	},
	// --- CROWD SYSTEM ---
    crowdTimer: null,
	// --- CROWD HYPE SYSTEM ---
    crowdExcitedUntil: 0,

	triggerExcitement: function(durationMs) {
        const now = Date.now();
        this.crowdExcitedUntil = now + durationMs;

        if (this.crowdTimer) clearTimeout(this.crowdTimer);
        
        // FIX: Assign this 500ms delay to crowdTimer so it can be killed if the player quits immediately
        this.crowdTimer = setTimeout(() => this.startCrowdLoop(), 500);
    },

    startCrowdLoop: function() {
        if (this.crowdTimer) clearTimeout(this.crowdTimer);

        const loop = () => {
            // Only spawn if active
            if (this.mode !== 'menu' && !document.hidden && !this.isTutorial) {
                this.spawnCrowdShout();
            }

            // CHECK HYPE STATE
            const now = Date.now();
            let nextTime;

            if (now < this.crowdExcitedUntil) {
                // HYPE MODE: 1.5 to 3.5 seconds (Fast!)
                nextTime = Math.random() * 1000 + 500;
            } else {
                // CASUAL MODE: 12 to 25 seconds (Relaxed)
                nextTime = Math.random() * 4000 + 2000;
            }

            this.crowdTimer = setTimeout(loop, nextTime);
        };

        loop();
    },
	
	// NEW FUNCTION: The absolute kill switch
    stopCrowdLoop: function() {
        if (this.crowdTimer) {
            clearTimeout(this.crowdTimer);
            this.crowdTimer = null;
        }
        
        // Purge any lingering shout bubbles instantly
        document.querySelectorAll('.crowd-shout').forEach(el => el.remove());
    },

    spawnCrowdShout: function() {
        const phrases = [
            "頑張れ!<br><small>Ganbare!</small>",       // Hang in there!
            "よいしょ!<br><small>Yoisho!</small>",       // Heave-ho!
            "残った!<br><small>Nokotta!</small>",        // Still in it!
            "はっけよい!<br><small>Hakkeyoi!</small>",   // Get ready!
            "よっしゃ!<br><small>Yossha!</small>",       // Alright!
            "行け行け!<br><small>Ike-ike!</small>",      // Go go!
            "相撲だ!<br><small>Sumo-da!</small>",        // This is Sumo!
            "押忍!<br><small>Osu!</small>",              // Push/Patience!
            "わっしょい!<br><small>Wasshoi!</small>",    // Heave! (Festival chant)
            "気合い!<br><small>Kiai!</small>"            // Spirit!
        ];
        const text = phrases[Math.floor(Math.random() * phrases.length)];
		
		sound.play('shout');

        const el = document.createElement('div');
        el.className = 'crowd-shout';
        el.innerHTML = text;

        // Randomize Vertical Position (20% to 80% down the screen)
        const topPos = 20 + Math.random() * 40;
        el.style.top = topPos + '%';

        // Randomize Side (Left 10% or Right 10%)
        const isLeft = Math.random() > 0.5;
        if (isLeft) {
            el.style.left = (Math.random() * 10) + '%';
            el.style.borderRadius = "20px 20px 20px 2px"; // Tail points left
        } else {
            el.style.right = (Math.random() * 10) + '%';
            el.style.borderRadius = "20px 20px 2px 20px"; // Tail points right
            el.style.transformOrigin = "bottom right"; // Animation pivot
        }
        
        // Random slight rotation for organic feel
        const rot = (Math.random() * 30) - 15; // -5 to +5 degrees
        el.style.setProperty('--rot', rot + 'deg'); // We can use this in CSS transform if needed, but simple keyframes work too.

        document.body.appendChild(el);

        // Cleanup after animation (2.5s)
        setTimeout(() => {
            el.remove();
        }, 2500);
    },
	
	forceStallMove: function() {
		// Determine which player number the local client is
        let myPlayerNum = 1; // Default to P1 for local/host
        if (this.mode === 'online' && typeof net !== 'undefined' && net.side === 'join') {
            myPlayerNum = 2;
        }

        console.log("Time's up! Forcing stall move.");

        // Pass it exactly as if the player clicked a UI button.
        // NOTE: Change 'this.processPlayerMove' to whatever your actual move submission function is called!
        this.submitMove(myPlayerNum, 'stall'); 
    },
	
	refreshNewCategoryFlags: function() {
		// Reset all to false first
		this.newUnlocksByCategory = { mawashi: false, skin: false, tech: false, dohyo: false };

		// Look at every unseen ID and flip the category flag back to true if it exists
		this.unseenItemIds.forEach(id => {
			// Check if it's a move (Technique)
			if (MOVES[id]) {
				this.newUnlocksByCategory.tech = true;
			} 
			// Check if it's an achievement linked to a cosmetic
			const cosmetic = Object.values(COSMETICS).find(c => c.req === id);
			if (cosmetic) {
				this.newUnlocksByCategory[cosmetic.type] = true;
			}
			
			//const dohyo = Object.values(DOHYO).find(c => c.req === id);
			//if (dohyo) {
				//this.newUnlocksByCategory[dohyo.type] = true;		// TODO: Fix This BS
			//}
		});

		// Finally, update the main button shimmer
		this.updateStableNotification();
	},
	
	openStable: function() {
		this.hideOverlays();
		document.body.classList.remove('hit-stop', 'game-over-active');
		
		const stableScreen = document.getElementById('stable-screen');
		if (stableScreen) stableScreen.classList.remove('hidden');
		
		const overlay = document.getElementById('stable-overlay');
		if (overlay) overlay.classList.remove('hidden');

		// --- NEW: Check if the player owns any custom Dohyo ---
		let hasCustomDohyo = false;
		
		// Use window.COSMETICS or COSMETICS depending on your scope, checking both just in case!
		const cosmeticsDict = typeof COSMETICS !== 'undefined' ? COSMETICS : window.COSMETICS;
		
		if (cosmeticsDict) {
			hasCustomDohyo = Object.keys(cosmeticsDict).some(k => {
				const item = cosmeticsDict[k];
				// It is a dohyo, it is NOT the default, and the player meets the achievement requirement
				return item.type === 'dohyo' && 
					   k !== 'dohyo_default' && 
					   (!item.req || (this.achievements && this.achievements[item.req]));
			});
		}

		// Toggle the hidden class on the Dohyo tab button based on what we found
		const dohyoTabBtn = document.getElementById('tab-dohyo');
		if (dohyoTabBtn) {
			if (hasCustomDohyo) {
				dohyoTabBtn.classList.remove('hidden');
			} else {
				dohyoTabBtn.classList.add('hidden'); // Failsafe: keep it hidden if they wipe their save
			}
		}
		// ------------------------------------------------------

		this.hasNewUnlocks = false;
		this.updateStableNotification();
		this.updateTabIndicators();

		// THE FIX: We deleted the obsolete 'stable-deck' logic that was crashing the script.
		// Now, we let the Tab system safely handle everything (including the Preview Rikishi)!
		this.switchStableTab('mawashi'); 
	},
	
	// Helper to get the text for the locked card
	getUnlockConditionText: function(moveKey) {
		const map = {
			'komatasuku': 'Beat Jonokuchi',
			'yorigiri': 'Beat Jonidan',
			'ketaguri': 'Beat Sandanme',
			'shitatenhineri': 'Beat Makushita',
			'nodowa': 'Beat Juryo',
			'utchari': 'Conquer Makuuchi'
		};
		return map[moveKey] || "Unknown";
	},
	
	renderPreviewRikishi: function() {
        const previewEl = document.getElementById('preview-rikishi');
        if (!previewEl) return;

        // Reset classes
        previewEl.className = 'rikishi';
        
        // Apply Skin
        const skinClass = COSMETICS[this.playerCosmetics.skin]?.class;
        if (skinClass) previewEl.classList.add(skinClass);
        
        // Apply Mawashi
        const mawClass = COSMETICS[this.playerCosmetics.mawashi]?.class;
        if (mawClass) previewEl.classList.add(mawClass);

        // --- NEW: Render Stripes based on current deck ---
        this.renderMawashiStripes(previewEl, this.playerLoadout);
		
		// Apply Top Knot per Experience as needed.
		this.updateAvatarHair();
    },

    closeStable: function() {
		this.refreshNewCategoryFlags();
        document.getElementById('stable-screen').classList.add('hidden');
        // If an overlay was left open (glitch safety), remove it
        const openOverlay = document.querySelector('.tech-overlay');
        if (openOverlay) openOverlay.remove();
        
        document.getElementById('title-screen').classList.remove('hidden');
		
		const heyaBtn = document.getElementById('global-heya-btn');
        if (heyaBtn) heyaBtn.classList.remove('hidden');
    },

	switchStableTab: function(tab) {
        this.stableTab = tab;
        
        const stableScreen = document.getElementById('stable-screen');
        if (!stableScreen) return;

        const btns = stableScreen.querySelectorAll('.tab-btn');
        btns.forEach(b => b.classList.remove('active'));
        
        // --- THE FIX: Safe ID targeting ---
        if(tab === 'mawashi') document.getElementById('tab-mawashi')?.classList.add('active');
        if(tab === 'skin') document.getElementById('tab-skin')?.classList.add('active');
        if(tab === 'dohyo') document.getElementById('tab-dohyo')?.classList.add('active');
        if(tab === 'tech') document.getElementById('tab-tech')?.classList.add('active');

        const stableGrid = document.getElementById('stable-grid');
        
        if (tab === 'tech') {
            if (stableGrid) {
                stableGrid.style.display = 'flex';
                stableGrid.style.flexDirection = 'column';
                stableGrid.style.alignItems = 'center';
            }
            this.renderTechGrid();
        } else {
            if (stableGrid) {
                stableGrid.style.display = '';
                stableGrid.style.flexDirection = '';
                stableGrid.style.alignItems = '';
            }
            this.renderStableGrid(); // Your existing function will automatically render the dohyo items because of the type property!
        }
        
        this.newUnlocksByCategory[tab] = false;
        this.updateTabIndicators();

        const anyLeft = Object.values(this.newUnlocksByCategory).some(v => v === true);
        if (!anyLeft) {
            this.hasNewUnlocks = false;
            this.updateStableNotification(); 
        }
    },

    renderStableGrid: function() {
        const grid = document.getElementById('stable-grid');
        if (!grid) return;
        
        grid.innerHTML = '';
        grid.className = 'stable-grid'; 
        
        // Use the current tab (mawashi or skin)
        const currentTab = this.stableTab || 'mawashi';
        
        const items = Object.entries(COSMETICS).filter(([key, data]) => data.type === currentTab);

        items.forEach(([key, data]) => {
            const isDefault = data.req === null;
            const isUnlocked = isDefault || (this.achievements && this.achievements[data.req]);

            // --- THE FIX: If it's not unlocked, completely skip it! ---
            if (!isUnlocked) {
                return; 
            }

            const el = document.createElement('div');
            
            // Determine if it's currently selected OR new
            const isSelected = this.playerCosmetics && this.playerCosmetics[currentTab] === key;
            const isNew = this.unseenItemIds.has(data.req); 

            // We removed the 'locked' class logic since it's impossible to reach here if locked
            el.className = `stable-item ${isSelected ? 'selected' : ''}`;

            // Apply the shimmering highlight if it's new
            if (isNew) el.classList.add('item-new-highlight');

            // We also removed the if(isUnlocked) check inside the click, since only unlocked items have buttons now!
            el.onclick = () => {
                // 1. Cleanup "New" state if it exists
                if (this.unseenItemIds.has(data.req)) {
                    this.unseenItemIds.delete(data.req);
                    this.refreshNewCategoryFlags();
                }
                // 2. Perform the actual Equip
                this.equipItem(currentTab, key);
                this.renderStableGrid(); // Re-renders to update selection borders
            };

            // Directly use data.name and data.icon
            el.innerHTML = `
                <div class="item-icon">${data.icon}</div>
                <div class="item-name">${data.name}</div>
            `;
            
            grid.appendChild(el);
        });

        // VITAL: Update the rikishi standing in the stable to show your choice
        this.renderPreviewRikishi();
    },

    equipItem: function(type, key) {
        this.playerCosmetics[type] = key;
        this.saveCosmetics();
        this.renderStableGrid();
        this.updateStablePreview();
        sound.play('click');
    },
	
	applyDohyoTheme: function(dohyoId) {
        const dohyoEl = document.querySelector('.dohyo-ring');
        if (!dohyoEl) return;
        
        // 1. Wipe all custom classes by resetting it to purely 'dohyo-ring'
        dohyoEl.className = 'dohyo-ring';
        
        // 2. Clear any lingering particle containers from previous themes
        const oldContainers = dohyoEl.querySelectorAll('.fire-container, .neon-container, .ice-container');
        oldContainers.forEach(container => container.remove());
        
        // 3. Look up the ID in the dictionary
        if (dohyoId && window.COSMETICS && window.COSMETICS[dohyoId]) {
            const themeClass = window.COSMETICS[dohyoId].class;
            
            if (themeClass) {
                dohyoEl.classList.add(themeClass);
            }

            // --- 4. FIRE THEME PARTICLE GENERATOR ---
            if (themeClass === 'dohyo-fire') {
                const fireContainer = document.createElement('div');
                fireContainer.className = 'fire-container';
                const numParticles = 50; 
                
                for (let i = 0; i < numParticles; i++) {
                    const p = document.createElement('div');
                    p.className = 'fire-particle';
                    
                    // The math is wrapped in a function so it can be re-rolled on every loop
                    const randomizeFire = () => {
                        const angle = Math.random() * Math.PI * 2; 
                        const radiusPct = 46 + (Math.random() * 5); 
                        p.style.left = `${50 + Math.cos(angle) * radiusPct}%`;
                        p.style.top = `${50 + Math.sin(angle) * radiusPct}%`;
                    };
                    
                    randomizeFire(); // Apply the first random position
                    p.style.animationDelay = `${Math.random() * 1}s`; 
                    
                    // MAGIC TRICK: While the particle is invisible at the end of the animation, teleport it!
                    p.addEventListener('animationiteration', randomizeFire);
                    
                    fireContainer.appendChild(p);
                }                
                dohyoEl.appendChild(fireContainer);

            // --- 5. NEON THEME PARTICLE GENERATOR ---
            } else if (themeClass === 'dohyo-neon') {
                const neonContainer = document.createElement('div');
                neonContainer.className = 'neon-container';
                const numSparks = 25; 
                
                for (let i = 0; i < numSparks; i++) {
                    const p = document.createElement('div');
                    p.className = 'neon-spark';
                    
                    // THE FIX: Set speed and delay ONCE, outside the looping function!
                    p.style.animationDuration = `${0.6 + Math.random() * 0.8}s`; 
                    p.style.animationDelay = `${Math.random() * 3}s`; 
                    
                    const randomizeNeon = () => {
                        const angle = Math.random() * Math.PI * 2; 
                        const radiusPct = 48 + (Math.random() * 3); 
                        p.style.left = `${50 + Math.cos(angle) * radiusPct}%`;
                        p.style.top = `${50 + Math.sin(angle) * radiusPct}%`;
                        
                        const sparkAngle = angle + (Math.random() - 0.5) * 1.5; 
                        const distance = 10 + Math.random() * 30; 
                        const tx = Math.cos(sparkAngle) * distance;
                        const ty = Math.sin(sparkAngle) * distance - (5 + Math.random() * 15); 
                        const rot = (sparkAngle * 180 / Math.PI) + 90; 
                        const hue = Math.random() > 0.5 ? 180 : 300; 

                        p.style.setProperty('--tx', `${tx}px`);
                        p.style.setProperty('--ty', `${ty}px`);
                        p.style.setProperty('--rot', `${rot}deg`);
                        p.style.setProperty('--hue', hue);
                    };

                    randomizeNeon();
                    p.addEventListener('animationiteration', randomizeNeon);
                    neonContainer.appendChild(p);
                }                
                dohyoEl.appendChild(neonContainer);

            // --- 6. ICE THEME PARTICLE GENERATOR ---
            } else if (themeClass === 'dohyo-ice') {
                const iceContainer = document.createElement('div');
                iceContainer.className = 'ice-container';
                const numFlakes = 30; 
                
                for (let i = 0; i < numFlakes; i++) {
                    const p = document.createElement('div');
                    p.className = 'ice-flake';
                    
                    p.style.animationDuration = `${4 + Math.random() * 4}s`; 
                    p.style.animationDelay = `${Math.random() * 5}s`; 
                    
                    const randomizeIce = () => {
                        // FIX: Calculate a random spot on the circular border of the dohyo
                        const angle = Math.random() * Math.PI * 2; 
                        
                        // Jitter between 48% and 51% radius to hug the ring
                        const radiusPct = 48 + (Math.random() * 3); 
                        
                        p.style.left = `${50 + Math.cos(angle) * radiusPct}%`;
                        p.style.top = `${50 + Math.sin(angle) * radiusPct}%`;
                        
                        // Keep the gentle horizontal drift and size variation
                        const drift = (Math.random() - 0.5) * 60; 
                        const size = 2 + Math.random() * 4;
                        
                        p.style.width = `${size}px`;
                        p.style.height = `${size}px`;
                        p.style.setProperty('--drift', `${drift}px`);
                    };

                    randomizeIce();
                    p.addEventListener('animationiteration', randomizeIce);
                    iceContainer.appendChild(p);
                }
                
                dohyoEl.appendChild(iceContainer);
            }
        }
    },

    updateStablePreview: function() {
        const p = document.getElementById('preview-rikishi');
        p.className = 'rikishi';
        const mawKey = this.playerCosmetics.mawashi;
        const skinKey = this.playerCosmetics.skin;
        if (COSMETICS[mawKey].class) p.classList.add(COSMETICS[mawKey].class);
        if (COSMETICS[skinKey].class) p.classList.add(COSMETICS[skinKey].class);
    },

	renderTechGrid: function() {
		const targetGrids = ['stable-grid', 'build-tech-grid'];

		const activePlayer = this.getActiveBuildPlayer ? this.getActiveBuildPlayer() : 1;
		let currentLoadout = (activePlayer === 2 && this.mode === 'local') 
			? this.p2Loadout 
			: this.playerLoadout;

		const hasKinboshi = this.achievements && this.achievements['kinboshi'];
		const expectedSlots = hasKinboshi ? 5 : 4;

		// 👇 FIX: If entirely missing, provide defaults. 
		if (!currentLoadout) {
			currentLoadout = ['strike', 'sweep', 'thrust', 'throw'];
		}

		// 👇 FIX: Smartly append a unique move and sort it!
		if (currentLoadout.length < expectedSlots) {
			const fallbackPool = ['strike', 'sweep', 'thrust', 'throw', 'trip', 'push'];
			
			while (currentLoadout.length < expectedSlots) {
				const uniqueMove = fallbackPool.find(move => !currentLoadout.includes(move)) || 'strike';
				currentLoadout.push(uniqueMove);
			}
			
			if (typeof window !== 'undefined' && window.MOVES) {
				currentLoadout.sort((a, b) => (MOVES[a]?.cost || 0) - (MOVES[b]?.cost || 0));
			}
			
			// Force a save so the new 5th slot is permanently recorded
			if (this.saveLoadout && currentLoadout === this.playerLoadout) {
				this.saveLoadout(); 
			}
		}

		// 👇 NEW: Check if there are ANY unseen attack moves in the player's unlocked pool
		let hasUnseenMoves = false;
		if (this.career && this.career.unlockedMoves && this.unseenItemIds) {
			hasUnseenMoves = this.career.unlockedMoves.some(key => 
				this.unseenItemIds.has(key) && MOVES[key] && MOVES[key].type.includes('atk')
			);
		}

		targetGrids.forEach(gridId => {
			const grid = document.getElementById(gridId);
			if (!grid) return; 
			
			grid.innerHTML = '';
			const isBuildScreen = gridId === 'build-tech-grid';

			// --- INJECT THE SLIDER INTO THE STABLE ---
			if (!isBuildScreen) {
				// 1. Grab the saved value before we build the HTML
				const savedMom = this.playerBuildMom !== undefined ? this.playerBuildMom : 1;

				// Create a relative wrapper so the absolute button anchors to it, not the whole screen
				const wrapper = document.createElement('div');
				wrapper.style.cssText = 'position: relative; width: 100%; text-align: center; margin-bottom: 15px;';
				
				// 👇 THE FIX: Added a dedicated slot for the Deck Button between Willpower and Arsenal
				const sliderHTML = `
					<div class="stat-label" style="margin-bottom: 5px;">DEFAULT MOMENTUM</div>
					<div class="slider-controls" style="margin: 0 auto 5px auto; display: flex; justify-content: center; align-items: center; gap: 15px;">
						<button class="stable-slider-btn" onclick="game.adjustBuildMom(-1, 'stable')">◀</button>
						<div class="mom-track build-mom-track">
							<div class="mom-pip p1 ${savedMom >= 1 ? 'filled' : ''}" id="stable-b-pip-1"></div>
							<div class="mom-pip p1 ${savedMom >= 2 ? 'filled' : ''}" id="stable-b-pip-2"></div>
							<div class="mom-pip locked" id="stable-b-pip-3"></div>
							<div class="mom-pip locked" id="stable-b-pip-4"></div>
							<div class="mom-pip locked" id="stable-b-pip-5"></div>
							<div class="mom-pip locked" id="stable-b-pip-6"></div>
							<div class="mom-pip locked"></div>
							<div class="mom-pip locked"></div>
						</div>
						<button class="stable-slider-btn" onclick="game.adjustBuildMom(1, 'stable')">▶</button>
					</div>
					<div class="stat-desc" id="stable-mom-desc" style="line-height: 1.2;"></div>

					<div class="stat-label" style="margin-top: 15px; margin-bottom: 5px;">WILLPOWER MODIFIER</div>
					<div id="stable-will-modifier" class="modifier-stack" style="margin: 0 auto 5px auto; min-height: 24px; display: flex; justify-content: center;"></div>
					<div class="stat-desc" id="stable-will-desc" style="line-height: 1.2;"></div>
					
					<div id="deck-btn-slot" style="display: flex; justify-content: center; width: 100%; margin: 15px 0 5px 0;"></div>
					
					<div class="stat-label" style="margin-top: 15px; margin-bottom: 5px;">ARSENAL</div>
				`;
				wrapper.innerHTML = sliderHTML;

				// --- REPOSITIONED DECK BUTTON ---
				const deckBtn = document.createElement('button');
				// 👇 THE FIX: Stripped position: absolute, added flex-shrink so it holds its shape
				deckBtn.style.cssText = `
					position: relative;
					background: rgba(20, 20, 20, 0.8);
					border: 2px solid var(--gold);
					border-radius: 12px;
					width: 60px;
					height: 60px;
					cursor: pointer;
					display: flex;
					justify-content: center;
					align-items: center;
					transition: transform 0.2s, box-shadow 0.2s;
					box-shadow: 0 4px 8px rgba(0,0,0,0.5);
					padding: 0;
					outline: none;
					flex-shrink: 0;
					z-index: 10;
				`;
				
				// --- NEW: Check if the Deck has unseen items ---
				let deckBadgeHTML = '';
				if (this.newUnlocksByCategory && this.newUnlocksByCategory.deck) {
					deckBadgeHTML = `
						<div style="position: absolute; top: -8px; right: -8px; background: linear-gradient(135deg, #ffd700, #ffaa00); color: #5c3a00; font-weight: 900; font-size: 0.55rem; padding: 2px 5px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); pointer-events: none; letter-spacing: 0.5px; border: 1px solid #ffea80; z-index: 20;">
							NEW
						</div>
					`;
				}

				// 👇 THE FIX: Adjusted the inline styles of the card-tooltip to center properly above the button
				deckBtn.innerHTML = `
					${deckBadgeHTML}
					<svg viewBox="0 0 100 100" style="width: 85%; height: 85%; filter: drop-shadow(0px 3px 2px rgba(0,0,0,0.6)); overflow: visible;">
						<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#2c2c2c" stroke="#555" stroke-width="4" transform="translate(15, -5) rotate(15 50 50)"/>
						<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#4a3728" stroke="#888" stroke-width="4" transform="translate(0, 0) rotate(0 50 50)"/>
						<path d="M50 5 L95 38 L80 95 L20 95 L5 38 Z" fill="#f4ecd8" stroke="#d4af37" stroke-width="4" transform="translate(-15, 5) rotate(-15 50 50)"/>
						<circle cx="35" cy="55" r="10" fill="none" stroke="#8b0000" stroke-width="3"/>
						<path d="M35 45 L35 65 M25 55 L45 55" stroke="#8b0000" stroke-width="3"/>
					</svg>
					<div class="card-tooltip" style="bottom: 110%; left: 50%; transform: translateX(-50%); z-index: 10;">
						<span class="card-name" style="color: var(--gold);">RESOURCE DECK</span>
						<span class="card-cost" style="white-space: normal; text-align: center; margin-top: 4px;">Meditation & Focus</span>
						<span style="font-size:0.6rem; color:#aaa; margin-top:4px;">(Click to Edit)</span>
					</div>
				`;

				deckBtn.onmouseover = () => {
					deckBtn.style.transform = 'scale(1.05) translateY(-2px)';
					deckBtn.style.boxShadow = '0 6px 15px rgba(212, 175, 55, 0.4)';
				};
				deckBtn.onmouseout = () => {
					deckBtn.style.transform = 'scale(1)';
					deckBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
				};

				this.attachSmartClick(deckBtn, () => {
					if (typeof sound !== 'undefined') sound.play('click');
					this.openDeckBuilder();
				});

				// 👇 THE FIX: Inject the button directly into the slot we created
				wrapper.querySelector('#deck-btn-slot').appendChild(deckBtn);
				grid.appendChild(wrapper);
				
				// 2. Call synchronously without setTimeout to prevent text flicker
				this.updateBuildUI('stable');
			}
			// -----------------------------------------

			// Create a dedicated wrapper for the buttons so flexbox doesn't mess up the slider
			const btnWrapper = document.createElement('div');
			btnWrapper.style.display = 'flex';
			btnWrapper.style.flexWrap = 'wrap';
			btnWrapper.style.justifyContent = 'center';
			btnWrapper.style.gap = isBuildScreen ? '12px' : '20px';
			btnWrapper.style.padding = isBuildScreen ? '10px 0' : '15px 0';

			currentLoadout.forEach((key, index) => {
				if (!MOVES[key]) return;
				const m = MOVES[key];

				const btn = document.createElement('button');
				let classes = 'card-btn atk';
				if (m.type.includes('low')) classes += ' low-move';
				btn.className = classes;
				
				if (isBuildScreen) {
					btn.style.transform = 'scale(0.85)';
					btn.style.margin = '-5px'; 
				}

				const editBadge = document.createElement('div');
				editBadge.innerHTML = '✎';
				editBadge.style.cssText = `
					position: absolute; top: -5px; right: -5px;
					background: var(--ink-color); color: white;
					font-size: 0.6rem; width: 16px; height: 16px;
					border-radius: 50%; display: flex; align-items: center; justify-content: center;
					box-shadow: 0 2px 4px rgba(0,0,0,0.2); pointer-events: none;
				`;
				btn.appendChild(editBadge);

				// 👇 NEW: Inject the Golden NEW Badge if there are unseen moves
				if (hasUnseenMoves) {
					const newBadge = document.createElement('div');
					newBadge.innerHTML = 'NEW';
					newBadge.style.cssText = `
						position: absolute; top: -8px; left: -8px;
						background: linear-gradient(135deg, #ffd700, #ffaa00);
						color: #5c3a00; font-weight: 900; font-size: 0.55rem;
						padding: 2px 5px; border-radius: 6px;
						box-shadow: 0 2px 4px rgba(0,0,0,0.3);
						pointer-events: none; letter-spacing: 0.5px;
						border: 1px solid #ffea80;
					`;
					btn.appendChild(newBadge);
				}

				let visualContent = MOVE_ICONS[key] ? 
					`<div style="width: 28px; height: 28px;">${MOVE_ICONS[key]}</div>` : 
					`<div style="font-size: 1.6rem; line-height: 1;">${m.icon || '?'}</div>`;

				// --- 1. THE TOOLTIP VARIABLE ---
				const guardBreakTooltipHtml = m.guardBreak ? `
					<span style="color: var(--accent-red); display: inline-flex; align-items: center; gap: 2px; margin-right: 4px;" title="Guard Break: -${m.guardBreak} Opponent Momentum">
						<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" style="filter: drop-shadow(0 0 2px rgba(217,58,58,0.8));">
							<path d="M7 8l5 5 5-5"/><path d="M7 14l5 5 5-5"/>
						</svg>x${m.guardBreak}
					</span> • ` : '';

				// --- 2. THE BADGE (Scaled down for the smaller Equipped UI slot) ---
				const guardBreakBadge = m.guardBreak ? `
					<div style="position: absolute; bottom: -2px; right: -2px; color: var(--accent-red); font-weight: 900; font-size: 0.55rem; background: var(--ink-color); padding: 1px 4px; border-radius: 4px; border: 1px solid var(--accent-red); display: flex; align-items: center; gap: 1px; z-index: 2; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">
						<svg viewBox="0 0 24 24" width="8" height="8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">
							<path d="M7 8l5 5 5-5"/><path d="M7 14l5 5 5-5"/>
						</svg>${m.guardBreak}
					</div>
				` : '';

				// --- 3. THE HTML INJECTION ---
				btn.innerHTML += `
					<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; pointer-events: none; position: relative;">
						${visualContent}
						${guardBreakBadge}
					</div>
					<div class="card-tooltip">
						<span class="card-name">${m.name}</span>
						<span class="card-cost">${m.cost > 0 ? m.cost + ' Mom' : 'Free'}</span>
						
						<span class="card-type" style="display: flex; align-items: center; justify-content: center;">
							${guardBreakTooltipHtml}${m.type.replace('atk_', '').toUpperCase()}
						</span>
						
						<span style="font-size:0.6rem; color:#aaa; margin-top:4px;">(Click to Swap)</span>
					</div>
				`;

				this.attachSmartClick(btn, () => {
					if (typeof sound !== 'undefined') sound.play('click');
					this.openTechSelector(index);
				});

				btnWrapper.appendChild(btn);

			});

			grid.appendChild(btnWrapper);

			// --- REVISED FOOTER (Reset Button Only) ---
			if (!isBuildScreen) {
				const footer = document.createElement('div');
				footer.style.width = "100%";
				footer.style.textAlign = "center";
				footer.style.marginTop = "20px";
				footer.style.display = "flex";
				footer.style.flexDirection = "column";
				footer.style.alignItems = "center";

				const resetBtn = document.createElement('button');
				resetBtn.className = 'text-btn';
				resetBtn.style.cssText = 'font-size:0.8rem; color:#888; background:none; border:none; cursor:pointer; text-decoration: underline;';
				resetBtn.innerHTML = 'Reset to Default Arsenal';
				resetBtn.onclick = () => {
					if (typeof sound !== 'undefined') sound.play('click');
					this.playerLoadout = expectedSlots === 5 ? ['strike', 'trip', 'sweep', 'thrust', 'throw'] : ['strike', 'sweep', 'thrust', 'throw'];
					this.playerBuildMom = 1; 
					this.saveLoadout();
					this.renderTechGrid();
				};
				footer.appendChild(resetBtn);

				grid.appendChild(footer);
			}
		});
	},

	openTechSelector: function(slotIndex) {
		// 1. Get all possible ATK moves
		const allAttacks = Object.keys(MOVES).filter(k => MOVES[k].type.includes('atk'));
		
		const activePlayer = this.getActiveBuildPlayer ? this.getActiveBuildPlayer() : 1;
		const activeLoadout = (activePlayer === 2 && this.mode === 'local') 
			? this.p2Loadout 
			: this.playerLoadout;

		const currentEquipped = new Set(activeLoadout);

		// 2. Create Overlay
		const overlay = document.createElement('div');
		overlay.className = 'tech-overlay';
		
		const content = document.createElement('div');
		content.className = 'tech-overlay-content';
		content.innerHTML = `<h3>Select Kamarite</h3><p style="margin-bottom:15px; font-size:0.9rem; color:#666;">Choose a kamarite to equip:</p>`;
		
		const grid = document.createElement('div');
		grid.className = 'tech-pool-grid';

		// 3. Render Available Moves
		let movesAdded = 0; 

		allAttacks.forEach(key => {            
			if (!this.career.unlockedMoves.includes(key)) return;            

			movesAdded++; 

			const m = MOVES[key];
			const btn = document.createElement('div');
			btn.className = 'tech-pool-card';
			btn.style.position = 'relative'; 
			
			const isNew = this.unseenItemIds.has(key);
			if (isNew) btn.classList.add('item-new-highlight');

			const isEquipped = currentEquipped.has(key);

			if (m.type.includes('low')) {
				btn.style.backgroundColor = '#fffde7';
				btn.style.borderColor = '#fdd835';
			}
			
			if (isEquipped) {
				btn.style.opacity = '0.85';
			}

			const guardBreakBadge = (m.guardBreak) ? `
				<div style="display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--accent-red); margin-top: 4px; font-weight: 900; font-size: 0.7rem; background: rgba(217, 58, 58, 0.08); padding: 1px 4px; border-radius: 4px; border: 1px solid rgba(217, 58, 58, 0.2);">
					<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none">
						<path d="M7 8l5 5 5-5"/><path d="M7 14l5 5 5-5"/>
					</svg>
					<span>x ${m.guardBreak}</span>
				</div>
			` : '';

			const equippedOverlay = isEquipped ? `
				<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; z-index: 10; border-radius: inherit; pointer-events: none;">
					<span style="background: #333; color: white; padding: 2px 6px; font-size: 0.6rem; font-weight: bold; border-radius: 3px; letter-spacing: 1px; transform: translateY(-46px); box-shadow: 0 2px 4px rgba(0,0,0,0.3);">EQUIPPED</span>
				</div>
			` : '';

			// --- THE FIX: ADDING THE NAME LABEL ---
			// We add a 'pool-name' div at the top of the card content
			btn.innerHTML = `
				${equippedOverlay}
				<div class="pool-name" style="font-weight: 800; font-size: 0.75rem; color: #4a3728; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-family: var(--font-ui, sans-serif);">
					${m.name}
				</div>
				<div class="pool-icon" style="font-size: 1.6rem; margin-bottom: 4px;">${MOVE_ICONS[key] || '?'}</div>
				<div class="pool-meta" style="display: flex; flex-direction: column; align-items: center;">
					<div style="font-size: 0.65rem; opacity: 0.6; font-weight: bold;">${m.cost} MOMENTUM</div>
					${guardBreakBadge}
				</div>
			`;
			
			btn.onclick = () => {
				if (this.unseenItemIds.has(key)) {
					this.unseenItemIds.delete(key);
					this.refreshNewCategoryFlags(); 
				}
				
				if (isEquipped) {
					const oldIndex = activeLoadout.indexOf(key);
					const moveBeingReplaced = activeLoadout[slotIndex];
					activeLoadout[oldIndex] = moveBeingReplaced;
				}

				this.equipMove(slotIndex, key);
				overlay.remove();
				if (typeof sound !== 'undefined') sound.play('click');
			};
			grid.appendChild(btn);
		});

		// 4. EMPTY STATE CHECK
		if (movesAdded <= currentEquipped.size) {
			grid.style.display = 'block'; 
			grid.innerHTML = `
				<div style="text-align: center; padding: 30px 15px; color: #888;">
					<div style="font-size: 2.5rem; margin-bottom: 15px; opacity: 0.3;">⛩️</div>
					<div style="font-size: 1.1rem; font-weight: bold; color: #4a3728; margin-bottom: 5px; letter-spacing: 2px;">JONOKUCHI</div>
					<span style="font-size: 0.85rem; color: #777;">Climb the Banzuke ranks to forge your arsenal!</span>
				</div>
			`;
		}

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'menu-btn secondary';
		cancelBtn.style.marginTop = '20px';
		cancelBtn.innerText = 'Cancel';
		cancelBtn.onclick = () => {
			if (typeof sound !== 'undefined') sound.play('click');
			overlay.remove();
		};

		content.appendChild(grid);
		content.appendChild(cancelBtn);
		overlay.appendChild(content);
		document.body.appendChild(overlay);
	},

	equipMove: function(index, newKey) {
        const activePlayer = this.getActiveBuildPlayer ? this.getActiveBuildPlayer() : 1;
        
        if (activePlayer === 2 && this.mode === 'local') {
            // PLAYER 2 LOGIC (Temporary Local Memory)
            this.p2Loadout[index] = newKey;
            this.p2Loadout.sort((a, b) => MOVES[a].cost - MOVES[b].cost);
            // Notice: We specifically omit this.saveLoadout() here!
        } else {
            // PLAYER 1 / ONLINE LOGIC (Career Memory)
            this.playerLoadout[index] = newKey;
            this.playerLoadout.sort((a, b) => MOVES[a].cost - MOVES[b].cost);
            this.saveLoadout(); 
        }
        
        this.renderTechGrid();
        if (this.renderPreviewRikishi) this.renderPreviewRikishi();
    },
	
	getExpAndHair: function(ignoreRules = false) {
        const s = this.career?.style || { success: {a:0, b:0, d:0}, total: {a:0, b:0, d:0} };
        
        // 1. Calculate Lifetime Actions
        const lifetimeSuccess = (s.success.a || 0) + (s.success.b || 0) + (s.success.d || 0);
        const lifetimeTotal = (s.total.a || 0) + (s.total.b || 0) + (s.total.d || 0);

        // Calculate Lifetime Eligible Wins
        const qp = this.career?.quickPlay || {};

        let lifetimeCpuWins = 0;
        Object.keys(qp).forEach(k => {
            if (k.startsWith('div_') || k.startsWith('cpu_')) {
                lifetimeCpuWins += (qp[k].wins || 0);
            }
        });

        const lifetimeOnlineWins = qp.online?.wins || 0;
        const lifetimeEligibleWins = lifetimeCpuWins + lifetimeOnlineWins;

        // 2. Subtract actions from previous "lives" to get the Current Run Actions
        const retired = this.career?.retiredActions || { success: 0, total: 0, wins: 0 };
        const successActions = Math.max(0, lifetimeSuccess - retired.success);
        const totalActions = Math.max(0, lifetimeTotal - retired.total);
        const failedActions = Math.max(0, totalActions - successActions);
        
        const currentRunWins = Math.max(0, lifetimeEligibleWins - (retired.wins || 0));


        // 3. Apply Rebirth Multiplier 
        const baseExp = (successActions * 2) + (failedActions * 1) + (currentRunWins * 5);
        const mult = this.career?.expMult || 1.0;
        const exp = Math.floor(baseExp * mult);

        let stage = 0;
        let nextThreshold = MAGE_EXP;
        let title = "Zambara (Short Hair)";

        if (exp >= OICHOMAGE_EXP) {
            stage = 4;
            nextThreshold = "MAX";
            title = "Ōichōmage (Full Top Knot)";
        } else if (exp >= TSUYAMAGE_EXP) {
            stage = 3; 
            nextThreshold = OICHOMAGE_EXP;
            title = "Tsuyamage (Glossy Top Knot)";
        } else if (exp >= OCHOMAGE_EXP) {
            stage = 2;
            nextThreshold = TSUYAMAGE_EXP;
            title = "Chonmage (Shoulder Length)";
        } else if (exp >= MAGE_EXP) {
            stage = 1;
            nextThreshold = OCHOMAGE_EXP;
            title = "Mage (Medium Length)";
        }

        // If we are online and NOT ignoring rules, clamp the stage directly from the net object
        if (!ignoreRules && this.mode === 'online' && typeof net !== 'undefined' && net.matchRules && net.matchRules.maxBuild !== undefined) {
            stage = net.matchRules.maxBuild;
            
            // Sync the title to match the enforced stage
            if (stage === 4) title = "Ōichōmage (Full Top Knot)";
            else if (stage === 3) title = "Tsuyamage (Glossy Top Knot)";
            else if (stage === 2) title = "Chonmage (Shoulder Length)";
            else if (stage === 1) title = "Mage (Medium Length)";
            else { stage = 0; title = "Zambara (Short Hair)"; }
        }

        return { exp, stage, nextThreshold, title, hasTopKnot: stage >= 2 };
    }
};

window.game = game;

/* --- NETWORKING (Firebase Firestore) --- */
const net = {
	matchId: null,
	unsubscribe: null,
	side: null, // 'host' or 'join'
	
	opponentHasGold: false, 
	opponentHosho: 1000, 
	opponentName: "OPPONENT",
	opponentCosmetics: null,
	opponentLoadout: null,
	
	// Tracking state changes to prevent duplicate triggers
	handshakeComplete: false,
	oppBuildProcessed: false,
	oppTurnProcessed: -1,
	oppQTEProcessedTurn: -1,
	lastOppCycleTime: 0,
	queuedMove: null,
	matchRules: { maxBuild: 4, skillLimit: false, isCasual: false, isBlitz: false },

	// --- TOURNAMENT (BASHO) STATE ---
	activeBashoId: null,
	bashoData: null,
	bashoUnsubscribe: null,

	reset: function() {
		if (this.matchId) {
			try { 
				db.collection("matches").doc(this.matchId).update({ status: 'disconnected' }); 
			} catch(e) { console.log("Silent exit"); 
			}
		}

		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		if (this.bashoUnsubscribe) {
			this.bashoUnsubscribe();
			this.bashoUnsubscribe = null;
		}

		window.removeEventListener('beforeunload', this.disconnectHook);

		this.matchId = null;
		this.side = null;
		this.handshakeComplete = false;
		this.oppBuildProcessed = false;
		this.oppTurnProcessed = -1;
		this.oppQTEProcessedTurn = -1;
		this.isRematching = false;
		this.queuedMove = null;
		this.lastOppCycleTime = 0;
		
		this.activeBashoId = null;
		this.bashoData = null;
		this.bashoFinished = false;
		this.pendingJoinTourneyId = null;

		this.isBashoCPUMatch = false; 
		this.bashoCPUData = null;
		
		if (this.tempJoinSub) { this.tempJoinSub(); this.tempJoinSub = null; }

		const joinBtn = document.getElementById('btn-find-match');
		if (joinBtn) { joinBtn.innerText = "FIND MATCH"; joinBtn.disabled = false; }
		
		const postBtn = document.getElementById('btn-post-action');
		if (postBtn) { 
			postBtn.disabled = false; 
			postBtn.innerText = "REMATCH"; 
		}
		
		localStorage.removeItem('sumo_last_sync');
		BootManager.update('Populating Heya (部屋)...');
	},

	// --- 1V1 MATCHMAKING LOGIC ---
	findMatch: async function() {
		if (typeof currentUserUID === 'undefined' || !currentUserUID) {
			alert("Trouble Connecting to server... Please wait a moment and try again.");
			firebase.auth().signInAnonymously();
			return;
		}
		
		document.getElementById('online-main').classList.add('hidden');
		document.getElementById('online-searching').classList.remove('hidden');
		
		const statusEl = document.getElementById('matchmaking-status');
		statusEl.className = 'pulsing-text'; 
		statusEl.innerHTML = 'Searching for Match...';

		const skillLimit = document.getElementById('mm-skill-limit').checked;
		const reqMaxBuild = parseInt(document.getElementById('mm-max-build').value);
		const reqBlitz = document.getElementById('mm-blitz-mode').checked;
		const myHosho = game.career.hosho_kin;

		this.reset(); 
		const matchesRef = db.collection("matches");

		try {
			const snapshot = await matchesRef.where("status", "==", "waiting")
											 .orderBy("createdAt", "asc")
											 .get(); 

			let matchedLobby = null;

			for (let doc of snapshot.docs) {
				const lobbyData = doc.data();
				if (lobbyData.hostUID === currentUserUID) {
					matchedLobby = doc; 
					break; 
				}

				const rules = lobbyData.rules || { maxBuild: 4, skillLimit: false };
				const hostHosho = lobbyData.hostData.hosho || 0;

				if (rules.maxBuild !== reqMaxBuild) continue;
				if (rules.isBlitz !== reqBlitz) continue;
				if (skillLimit || rules.skillLimit) {
					if (Math.abs(hostHosho - myHosho) > 200) continue; 
				}

				matchedLobby = doc;
				break; 
			}

			if (matchedLobby) {
				const lobbyData = matchedLobby.data();
				if (lobbyData.hostUID === currentUserUID) {
					await this.createLobby(matchesRef, statusEl);
					return;
				}

				const success = await db.runTransaction(async (transaction) => {
					const doc = await transaction.get(matchedLobby.ref);
					if (!doc.exists || doc.data().status !== "waiting") return false; 

					transaction.update(matchedLobby.ref, {
						status: "playing",
						joinData: {
							uid: currentUserUID,
							hosho: game.career.hosho_kin,
							cosmetics: game.playerCosmetics,
							loadout: game.playerLoadout,
							playerName: game.getLocalName()
						}
					});
					return true;
				});

				if (success) {
					this.matchId = matchedLobby.id;
					this.side = 'join';
					this.matchRules = lobbyData.rules; 
					this.setupConn();
				} else {
					this.findMatch(); 
				}
			} else {
				await this.createLobby(matchesRef, statusEl);
			}
		} catch (err) {
			console.error("Matchmaking error:", err);
			statusEl.className = ''; 
			statusEl.innerHTML = '<span style="color:#d93a3a">⚠️ Network error. Retrying...</span>';
			setTimeout(() => this.findMatch(), 2000);
		}
	},

	createLobby: async function(matchesRef, statusEl, isPrivate = false) {
		const oldLobbies = await matchesRef.where("hostUID", "==", currentUserUID).get();
		const batch = db.batch();
		
		oldLobbies.forEach(doc => {
			const status = doc.data().status;
			if (status === "waiting" || status === "private_waiting") {
				batch.delete(doc.ref);
			}
		});
		await batch.commit();

		this.side = 'host';
		this.matchId = `lobby_${currentUserUID}_${Date.now()}`; 

		const rules = {
			isCasual: isPrivate ? document.getElementById('invite-casual').checked : false,
			maxBuild: isPrivate ? parseInt(document.getElementById('invite-max-build').value) : parseInt(document.getElementById('mm-max-build').value),
			skillLimit: isPrivate ? false : document.getElementById('mm-skill-limit').checked,
			isBlitz: isPrivate ? document.getElementById('invite-blitz-mode').checked : document.getElementById('mm-blitz-mode').checked
		};

		this.matchRules = rules;

		await matchesRef.doc(this.matchId).set({
			status: isPrivate ? "private_waiting" : "waiting",
			createdAt: firebase.firestore.FieldValue.serverTimestamp(),
			hostUID: currentUserUID,
			rules: rules, 
			hostData: {
				hosho: game.career.hosho_kin,
				cosmetics: game.playerCosmetics,
				loadout: game.playerLoadout,
				playerName: game.getLocalName()
			}
		});

		if (!isPrivate && statusEl) {
			statusEl.innerHTML = 'Lobby Created! <span style="color:#27ae60">● Online</span><br>Waiting for a challenger...';
		}
		
		this.setupConn();
	},

	setupConn: function() {
		window.addEventListener('beforeunload', this.disconnectHook);

		this.unsubscribe = db.collection("matches").doc(this.matchId)
			.onSnapshot((doc) => {
				if (!doc.exists) {
					this.handleDisconnect();
					return;
				}

				const data = doc.data();

				if (data.status === 'disconnected') {
					if (this.matchId) this.handleDisconnect(); 
					return;
				}

				const oppKey = this.side === 'host' ? 'joinData' : 'hostData';
				const oppData = data[oppKey];

				// --- PHASE 1: HANDSHAKE ---
				if (data.status === 'playing' && oppData && !this.handshakeComplete) {
					this.handshakeComplete = true;
				
					if (this.side === 'join' && data.rules) {
						this.matchRules = data.rules;
					}
					
					if (oppData.hosho !== undefined) this.opponentHosho = oppData.hosho;
					if (oppData.cosmetics) this.opponentCosmetics = oppData.cosmetics;
					if (oppData.loadout) this.opponentLoadout = oppData.loadout;
					if (oppData.playerName) this.opponentName = oppData.playerName;
					
					const statusEl = document.getElementById('matchmaking-status');
					if (statusEl) {
						statusEl.className = ''; 
						statusEl.innerHTML = '<span style="color:#27ae60">Match Found!</span>';
					}

					if (typeof sound !== 'undefined' && sound.enabled) {
						sound.play('powerup'); 
					}

					setTimeout(() => {
						const hostCosmetics = this.side === 'host' ? game.playerCosmetics : this.opponentCosmetics;
						const matchDohyo = (hostCosmetics && hostCosmetics.dohyo) ? hostCosmetics.dohyo : 'dohyo_default';
						
						if (typeof game !== 'undefined' && game.applyDohyoTheme) {
							game.applyDohyoTheme(matchDohyo);
						}

						game.resetAvatars(true); 
						game.startOnline(); 
					}, 1000);
				}

				if (!this.handshakeComplete || !oppData) return;

				if (this.isRematching) {
					if (oppData.turn === -1) {
						this.isRematching = false; 
						
						this.oppBuildProcessed = false;
						this.oppTurnProcessed = -1;
						this.oppQTEProcessedTurn = -1; 
						this.queuedMove = null;
						
						console.log("Opponent successfully scrubbed. Match 2 unlocked.");

						document.body.classList.remove('game-over-active');
						document.getElementById('post-match-overlay').classList.add('hidden');
						
						const btn = document.getElementById('btn-post-action');
						if (btn) btn.disabled = false;

						document.getElementById('build-screen').classList.remove('hidden');
						document.getElementById('build-msg').innerText = "SELECT YOUR STYLE";
					} else {
						return; 
					}
				}

				// --- PHASE 2: BUILD SELECTION ---
				if (oppData.build && !this.oppBuildProcessed) {
					this.oppBuildProcessed = true;
					if (oppData.hosho !== undefined) this.opponentHosho = oppData.hosho;
					
					const opponent = this.side === 'host' ? game.p2 : game.p1;
					game.applyBuild(opponent, oppData.build);
					this.checkBuildReady();
				}

				// --- PHASE 3: GAMEPLAY MOVES ---
				if (oppData.move && oppData.turn > this.oppTurnProcessed) {
					this.oppTurnProcessed = oppData.turn;
					
					const opponent = this.side === 'host' ? game.p2 : game.p1;
					opponent.moveCardIndex = oppData.moveCardIndex; 

					let explicitHandSize = null;
					if (oppData.handTypes && Array.isArray(oppData.handTypes)) {
						explicitHandSize = oppData.handTypes.length;
					}

					if (game.turnPhase === 3) {
						this.queuedMove = oppData.move;
						this.queuedHandSize = explicitHandSize; 
						// --- NEW: Save the types to the queue ---
						this.queuedHandTypes = oppData.handTypes; 
						console.log("Opponent is fast! Queuing move for next round.");
					} else {
						// --- NEW: Save the secret Ghost Hand for the combat engine ---
						opponent.networkHandTypes = oppData.handTypes; 
						this.applyOpponentMove(oppData.move, explicitHandSize);
					}
				}

				// --- PHASE 4: QTE RESULTS ---
				if (oppData.qteTurn !== undefined && oppData.qteTurn > this.oppQTEProcessedTurn) {
					this.oppQTEProcessedTurn = oppData.qteTurn;
					if (typeof game.receiveOpponentQTE === 'function') {
						game.receiveOpponentQTE(oppData.qteResult, oppData.qteGoldHits || 0);
					}
				}
				
				// --- PHASE 5: MANUAL CARD CYCLE SYNC (EVENT QUEUE) ---
				if (oppData.cycleEvents && oppData.cycleEvents.length > 0) {
					if (!this.processedCycles) this.processedCycles = [];
					
					const newCycles = oppData.cycleEvents.filter(c => !this.processedCycles.includes(c.id));

					newCycles.forEach((cycleEvent, i) => {
						this.processedCycles.push(cycleEvent.id);

						setTimeout(() => {
							const oppNum = this.side === 'host' ? 2 : 1;
							const opponent = this.side === 'host' ? game.p2 : game.p1;

							if (opponent.hand && opponent.hand[cycleEvent.index]) {
								opponent.hand[cycleEvent.index].type = cycleEvent.type;
							}

							if (typeof game.cycleOpponentCard === 'function') {
								game.cycleOpponentCard(oppNum, cycleEvent.index);
							}
						}, i * 900); 
					});
				}
			});
	},
	
	// --- INVITE SYSTEM LOGIC ---
	copyUID: function() {
		if (window.currentUserUID) {
			navigator.clipboard.writeText(window.currentUserUID).then(() => {
				if (typeof sound !== 'undefined') sound.play('click');
				const tag = document.getElementById('uid-text');
				const originalText = tag.innerText;
				tag.innerText = "COPIED!";
				setTimeout(() => { tag.innerText = originalText; }, 1500);
			});
		}
	},
	
	initOnlineUI: function() {
		const inviteSelect = document.getElementById('invite-max-build');
		if (!inviteSelect) return;
		
		inviteSelect.innerHTML = ''; 
		const stage = game.getExpAndHair().stage; 
		
		const buildNames = ["Zambara (Short Hair)", "Mage", "Chonmage", "Tsuyamage", "Ōichōmage"];
		
		for (let i = 0; i <= stage; i++) {
			const opt = document.createElement('option');
			opt.value = i;
			opt.text = i === stage ? `${buildNames[i]}` : buildNames[i];
			inviteSelect.appendChild(opt);
		}
		
		inviteSelect.value = stage;
	},

	showInviteScreen: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('online-main').classList.add('hidden');
		document.getElementById('online-invite-screen').classList.remove('hidden');
		document.getElementById('invite-uid-input').value = ''; 
		this.initOnlineUI(); 
	},

	cancelInviteScreen: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('online-invite-screen').classList.add('hidden');
		document.getElementById('online-main').classList.remove('hidden');
	},

	sendInvite: async function() {
		const input = document.getElementById('invite-uid-input').value.trim();
		
		if (!input || input === window.currentUserUID) {
			alert("Please enter a valid opponent UID or Email.");
			return;
		}

		let targetUID = input;

		if (input.includes('@')) {
			const userQuery = await db.collection("users")
				.where("email", "==", input.toLowerCase())
				.limit(1)
				.get();

			if (userQuery.empty) {
				alert("No player found with that email address.");
				return;
			}
			targetUID = userQuery.docs[0].id;
		}

		if (typeof sound !== 'undefined') sound.play('click');
		this.reset(); 

		document.getElementById('online-invite-screen').classList.add('hidden');
		document.getElementById('online-waiting-invite').classList.remove('hidden');
		document.getElementById('invite-status-text').innerHTML = 'Challenge Sent... Waiting for response.';

		const matchesRef = db.collection("matches");
		await this.createLobby(matchesRef, null, true);

		this.currentInviteRef = db.collection("invites").doc();
		await this.currentInviteRef.set({
			from: window.currentUserUID,
			fromName: game.getLocalName(),
			to: targetUID,
			matchId: this.matchId,
			status: 'pending',
			createdAt: firebase.firestore.FieldValue.serverTimestamp()
		});

		this.inviteUnsubscribe = this.currentInviteRef.onSnapshot((doc) => {
			if (!doc.exists) return; 
			const data = doc.data();

			if (data.status === 'declined') {
				if (typeof sound !== 'undefined') sound.play('powerdown'); 
				document.getElementById('invite-status-text').innerHTML = '<span style="color:#d93a3a">Challenge Declined!</span>';
				setTimeout(() => {
					this.cancelSentInvite(); 
				}, 2000);
			} 
			else if (data.status === 'accepted') {
				this.currentInviteRef.delete();
				if (this.inviteUnsubscribe) this.inviteUnsubscribe();
				
				document.getElementById('online-waiting-invite').classList.add('hidden');
				document.getElementById('online-searching').classList.remove('hidden');
			}
		});
	},

	cancelSentInvite: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		
		if (this.currentInviteRef) {
			this.currentInviteRef.delete();
			this.currentInviteRef = null;
		}
		if (this.inviteUnsubscribe) {
			this.inviteUnsubscribe();
			this.inviteUnsubscribe = null;
		}

		this.reset(); 
		
		document.getElementById('online-waiting-invite').classList.add('hidden');
		document.getElementById('online-main').classList.remove('hidden');
	},

	listenForInvites: function() {
		if (this.globalInviteSub) this.globalInviteSub();
		
		this.globalInviteSub = db.collection("invites")
			.where("to", "==", window.currentUserUID)
			.where("status", "==", "pending")
			.onSnapshot(snapshot => {
				snapshot.docChanges().forEach(change => {
					if (change.type === 'added') {
						const invite = change.doc.data();
						this.pendingInviteId = change.doc.id;
						this.pendingInviteData = invite;
						
						document.getElementById('invite-sender-name').innerText = `${invite.fromName} challenges you!`;
						document.getElementById('invite-overlay').classList.remove('hidden');
						
						if (typeof sound !== 'undefined') sound.play('achievement'); 
					}
				});
			});
	},

	acceptInvite: async function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('invite-overlay').classList.add('hidden');
		if (!this.pendingInviteData) return;
		
		const matchId = this.pendingInviteData.matchId;
		const inviteId = this.pendingInviteId;
		
		await db.collection("invites").doc(inviteId).update({ status: 'accepted' });
		
		const lobbyRef = db.collection("matches").doc(matchId);
		const success = await db.runTransaction(async (transaction) => {
			const doc = await transaction.get(lobbyRef);
			if (!doc.exists || doc.data().status !== "private_waiting") return false; 
			
			transaction.update(lobbyRef, {
				status: "playing",
				joinData: {
					uid: window.currentUserUID,
					hosho: game.career.hosho_kin,
					cosmetics: game.playerCosmetics,
					loadout: game.playerLoadout,
					playerName: game.getLocalName()
				}
			});
			return true;
		});

		if (success) {
			document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
			document.getElementById('online-menu').classList.remove('hidden');
			document.getElementById('online-main').classList.add('hidden');
			document.getElementById('online-searching').classList.remove('hidden');
			
			this.matchId = matchId;
			this.side = 'join';
			this.setupConn(); 
		} else {
			alert("Challenge is no longer valid or lobby was closed.");
		}
		
		this.pendingInviteId = null;
		this.pendingInviteData = null;
	},

	declineInvite: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('invite-overlay').classList.add('hidden');
		
		if (this.pendingInviteId) {
			db.collection("invites").doc(this.pendingInviteId).update({ status: 'declined' });
		}
		
		this.pendingInviteId = null;
		this.pendingInviteData = null;
	},
	
	// NEW: Accept explicitHandSize from the network payload!
	applyOpponentMove: async function(moveKey, explicitHandSize = null) {
		const oppNum = this.side === 'host' ? 2 : 1;
		const opponent = this.side === 'host' ? game.p2 : game.p1;
		const moveData = MOVES[moveKey];

		// --- THE FIX: PREVENT THEFT ON HESITATION ---
		// Determine if this move actually requires playing a physical card
		const isCardMove = moveKey !== 'hesitate' && moveKey !== 'timeout' && moveKey !== 'stall';

		let cardIndex = -1;
		
		if (isCardMove && opponent.hand) {
			let reqCard = 'build';
			if (moveData && moveData.type.includes('atk')) reqCard = moveData.type.includes('high') ? 'h_attack' : 'l_attack';
			else if (moveData && moveData.type.includes('def')) reqCard = moveData.type.includes('high') ? 'h_block' : 'l_block';

			// Favor the explicit network-synced index
			if (opponent.moveCardIndex !== undefined && opponent.moveCardIndex !== null && opponent.moveCardIndex !== -1) {
				cardIndex = opponent.moveCardIndex;
				opponent.moveCardIndex = -1; 
			} else {
				// Fallback to array search
				cardIndex = opponent.hand.findIndex(c => c.type === reqCard);
			}
		}

		// --- 1. VISUAL ANIMATIONS ---
		const domCards = document.querySelectorAll('[id^="opp-card-"]');
		if (isCardMove && domCards.length > 0 && cardIndex !== -1) {
			const spatialPan = oppNum === 1 ? -0.6 : 0.6;
			
			domCards.forEach(cardEl => {
				if (cardEl.classList.contains('opp-discard-shoot')) return;
				
				const idx = parseInt(cardEl.id.split('-').pop());
				cardEl.classList.remove('slide-over-bounce', 'flip-reveal-half', 'flip-reveal-full', 'card-draw-single', 'card-enter-cascade');
				
				if (idx === cardIndex) {
					cardEl.style.animationDelay = '0s';
					cardEl.classList.add('card-play-out-fast');
					if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan);
				} else {
					cardEl.style.animationDelay = `${idx * 0.03}s`;
					cardEl.classList.add('card-swoop-out');
					if (typeof sound !== 'undefined') sound.play('card_flick', spatialPan);
				}
			});

			await new Promise(resolve => setTimeout(resolve, 500));
		}

		// --- 2. GAME STATE LOGIC ---
		if (isCardMove && opponent.hand && cardIndex !== -1) {
			const spentCard = opponent.hand.splice(cardIndex, 1)[0];
			if (!opponent.discardPile) opponent.discardPile = [];
			opponent.discardPile.push(spentCard);
		}

		// --- 3. BULLETPROOF HAND SYNCHRONIZATION ---
		// If the network told us EXACTLY how many cards they have, force the array to match!
		if (explicitHandSize !== null && opponent.hand) {
			// Pad with mock cards if our local simulation deleted too many
			while (opponent.hand.length < explicitHandSize) {
				opponent.hand.push({ type: 'mock_network_card' });
			}
			// Trim excess cards if our local simulation failed to spend one
			while (opponent.hand.length > explicitHandSize) {
				opponent.hand.pop();
			}
			
			// Overflow check logic
			if (typeof game !== 'undefined' && typeof game.drawCards === 'function' && opponent.hand.length < 5) {
				game.drawCards(oppNum, 5 - opponent.hand.length);
			}
		}

		// --- 4. ENGINE LOCK-IN ---
		if (moveData && opponent.mom >= moveData.cost) {
			opponent.move = moveKey;
		} else if (!isCardMove) {
			opponent.move = moveKey; // Allow hesitate/timeout to pass through cleanly
		} else {
			console.warn(`⚠️ ILLEGAL MOVE: Opponent tried ${moveKey} with ${opponent.mom} Mom.`);
			opponent.move = 'build';
		}

		this.checkReady();
	},
	
	prepareRematch: function() {
		this.isRematching = true; 

		this.queuedMove = null;
		this.oppBuildProcessed = false;
		this.oppTurnProcessed = -1;
		this.oppQTEProcessedTurn = -1;
		this.lastOppCycleTime = 0;
		this.processedCycles = [];

		if (!this.matchId) return;
		const myKey = this.side === 'host' ? 'hostData' : 'joinData';
		
		db.collection("matches").doc(this.matchId).update({
			[`${myKey}.build`]: null,
			[`${myKey}.move`]: null,
			[`${myKey}.moveCardIndex`]: null,
			[`${myKey}.handTypes`]: null, // --- NEW: Clear Hand Sync ---
			[`${myKey}.cycleEvents`]: [],
			[`${myKey}.cycle`]: null, 
			[`${myKey}.turn`]: -1,
			[`${myKey}.qteResult`]: null, 
			[`${myKey}.qteTurn`]: -1     
		}).catch(err => console.log("Lobby scrub error:", err));
	},

	disconnectHook: function() {
		if (net.matchId) {
			db.collection("matches").doc(net.matchId).update({ status: 'disconnected' });
		}
	},

	handleDisconnect: function() {
		if (typeof game.stopCrowdLoop === 'function') game.stopCrowdLoop();
		localStorage.removeItem('sumo_rage_quit_guard');

		if (this.activeBashoId && this.bashoData && this.bashoData.status === 'playing') {
			alert("Your opponent fled! You win by forfeit. Advancing...");
			this.reportBashoResult(window.currentUserUID);
			
			if (this.unsubscribe) {
				this.unsubscribe();
				this.unsubscribe = null;
			}
			this.matchId = null;
			
			document.body.classList.add('game-over-active');
			document.getElementById('post-match-overlay').classList.remove('hidden');
			document.getElementById('post-match-res').innerHTML = "OPPONENT FORFEIT.<br><span class='pulsing-text'>WAITING FOR NEXT ROUND...</span>";
			const btn = document.getElementById('btn-post-action');
			if (btn) {
				btn.innerText = "WAITING...";
				btn.disabled = true;
			}
			return;
		}

		if (this.isRematching) {
			if (!this.matchRules.isCasual) {
				this.reset();
				
				document.body.classList.remove('game-over-active');
				document.getElementById('post-match-overlay').classList.add('hidden');
				document.getElementById('build-screen').classList.add('hidden');
				document.getElementById('online-waiting-loadout').classList.add('hidden');
				
				if (typeof game !== 'undefined' && game.backToTitle) game.backToTitle();
				
				setTimeout(() => {
					const onlineMenu = document.getElementById('online-menu');
					if (onlineMenu) onlineMenu.classList.remove('hidden');

					document.getElementById('mm-max-build').value = this.matchRules.maxBuild !== undefined ? this.matchRules.maxBuild : 4;
					document.getElementById('mm-skill-limit').checked = this.matchRules.skillLimit || false;
					document.getElementById('mm-blitz-mode').checked = this.matchRules.isBlitz || false;
					
					net.findMatch(); 
				}, 50);
			} else {
				alert("The private lobby has been closed.");
				document.getElementById('build-screen').classList.add('hidden');
				document.body.classList.remove('game-over-active');
				document.getElementById('post-match-overlay').classList.add('hidden');
				this.reset();
				if (typeof game !== 'undefined' && game.backToTitle) game.backToTitle();
			}
			return;
		}

		const isPostMatchOverlayUp = !document.getElementById('post-match-overlay').classList.contains('hidden');
		const isSomeoneKOd = (game.p1.hp <= 0 || game.p2.hp <= 0);
		
		if (isPostMatchOverlayUp || isSomeoneKOd) {
			this.reset();
			return;
		}
		
		if (game.turnPhase > 0) {
			alert("Opponent fled the Dojo! You win by forfeit.");
			const amHost = this.side === 'host';
			
			this.reset(); 
			game.updateMatchStats(amHost, !amHost);
			return; 
		} 

		alert("Opponent has left the match."); 
		
		document.getElementById('post-match-overlay').classList.add('hidden');
		document.body.classList.remove('game-over-active');
		document.getElementById('build-screen').classList.add('hidden');

		this.reset();
		if (typeof game !== 'undefined' && game.backToTitle) game.backToTitle();
	},
	
   sendMove: function(moveKey, cardIndex = -1) {
		if (!this.matchId) return;
		const myKey = this.side === 'host' ? 'hostData' : 'joinData';
		const currentTurn = game.matchStats.rounds || 0;
		
		// --- THE FIX: DYNAMIC HAND BROADCASTING ---
		// We safely determine which player object represents our local client,
		// and map our active hand into a lightweight array of strings (e.g. ['strike', 'kimedashi']).
		const localPlayer = this.side === 'host' ? game.p1 : game.p2;
		const localHand = localPlayer.hand ? localPlayer.hand.map(c => c.type) : [];
		
		db.collection("matches").doc(this.matchId).update({
			[`${myKey}.move`]: moveKey,
			[`${myKey}.moveCardIndex`]: cardIndex, 
			[`${myKey}.turn`]: currentTurn,
			[`${myKey}.handTypes`]: localHand 
		});
	},

	sendCycle: function(handIndex, cardType) {
		if (!this.matchId) return;
		const myKey = this.side === 'host' ? 'hostData' : 'joinData';
		
		db.collection("matches").doc(this.matchId).update({
			[`${myKey}.cycleEvents`]: firebase.firestore.FieldValue.arrayUnion({
				index: handIndex,
				type: cardType,
				id: Date.now() + "_" + Math.random().toString(36).substring(2, 9)
			})
		});
	},

	sendBuild: function(buildKey) {
		if (!this.matchId) return;
		const myKey = this.side === 'host' ? 'hostData' : 'joinData';
		
		db.collection("matches").doc(this.matchId).update({
			[`${myKey}.build`]: buildKey,
			[`${myKey}.hosho`]: game.career.hosho_kin
		});
	},

	sendQTEResult: function(passed, goldHits = 0) {
		if (!this.matchId) return;
		const myKey = this.side === 'host' ? 'hostData' : 'joinData';
		const currentTurn = game.matchStats.rounds || 0;
		
		db.collection("matches").doc(this.matchId).update({
			[`${myKey}.qteResult`]: passed,
			[`${myKey}.qteGoldHits`]: goldHits, 
			[`${myKey}.qteTurn`]: currentTurn
		});
	},

	checkReady: function() {
		if (game.p1.move && game.p2.move) game.resolveTurn();
	},

	checkBuildReady: function() {
		if (game.p1.build && game.p2.build) {
			game.initMatch(this.opponentName || "OPPONENT");
		}
	},

	// --- TOURNAMENT (BASHO) LOGIC ---
	showBashoBrowser: async function() {
		if (typeof sound !== 'undefined') sound.play('click');
		
		document.getElementById('online-main').classList.add('hidden');
		document.getElementById('basho-browser-screen').classList.remove('hidden');
		
		const listContainer = document.getElementById('basho-list-container');
		listContainer.innerHTML = '<div style="text-align: center; color: #888; margin-top: 30px; font-style: italic;" class="pulsing-text">Fetching active tournaments...</div>';

		try {
			const snapshot = await db.collection("tournaments")
				.where("status", "==", "lobby")
				.where("isPrivate", "==", false)
				.orderBy("createdAt", "desc")
				.get();

			listContainer.innerHTML = '';

			if (snapshot.empty) {
				listContainer.innerHTML = '<div style="text-align: center; color: #888; margin-top: 30px; font-style: italic;">No public tournaments found. Be the first to host one!</div>';
				return;
			}

			snapshot.forEach(doc => {
				const data = doc.data();
				const playerCount = Object.keys(data.players || {}).length;
				
				if (playerCount >= data.maxPlayers) return;

				const hostName = data.players[data.hostUID] ? data.players[data.hostUID].name : "Unknown Host";

				const tourneyCard = document.createElement('div');
				tourneyCard.style.cssText = `
					background: #fff; border: 2px solid var(--gold); border-radius: 6px; padding: 12px; 
					display: flex; justify-content: space-between; align-items: center; cursor: pointer;
					transition: transform 0.1s, box-shadow 0.1s;
				`;
				tourneyCard.onmouseover = () => { tourneyCard.style.transform = 'translateY(-2px)'; tourneyCard.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)'; };
				tourneyCard.onmouseout = () => { tourneyCard.style.transform = 'translateY(0)'; tourneyCard.style.boxShadow = 'none'; };
				
				tourneyCard.onclick = () => {
					if (typeof sound !== 'undefined') sound.play('click');
					net.promptJoinPublicBasho(doc.id);
				};

				tourneyCard.innerHTML = `
					<div style="text-align: left;">
						<div style="font-family: var(--font-title); font-size: 1.2rem; color: var(--ink-color);">${data.name}</div>
						<div style="font-family: var(--font-ui); font-size: 0.8rem; color: #666;">Host: ${hostName}</div>
					</div>
					<div style="text-align: right; font-family: var(--font-ui);">
						<div style="font-weight: bold; color: #8b0000; font-size: 1.1rem;">${playerCount} / ${data.maxPlayers}</div>
						<div style="font-size: 0.7rem; color: #999;">PLAYERS</div>
					</div>
				`;
				listContainer.appendChild(tourneyCard);
			});
			
			if (listContainer.innerHTML === '') {
				listContainer.innerHTML = '<div style="text-align: center; color: #888; margin-top: 30px; font-style: italic;">All public tournaments are currently full.</div>';
			}

		} catch (err) {
			console.error("Error fetching tournaments:", err);
			listContainer.innerHTML = '<div style="text-align: center; color: #d93a3a; margin-top: 30px; font-weight: bold;">⚠️ Error connecting to server. Please try again.</div>';
		}
	},

	closeBashoBrowser: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('basho-browser-screen').classList.add('hidden');
		document.getElementById('online-main').classList.remove('hidden');
	},

	// --- HOSTING ---
	promptHostBasho: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		document.getElementById('host-basho-alias-input').value = game.getLocalName();
		document.getElementById('host-basho-name-input').value = game.getLocalName() + "'s Basho";
		document.getElementById('host-basho-modal').classList.remove('hidden');
	},

	createBasho: async function() {
		const name = document.getElementById('host-basho-name-input').value || "Grand Tournament";
		const isPrivate = document.getElementById('host-basho-private').checked;
		const code = document.getElementById('host-basho-code-input').value;
		const maxPlayers = parseInt(document.getElementById('basho-max-players')?.value || 8);
		const hostAlias = document.getElementById('host-basho-alias-input').value.trim() || game.getLocalName();
		
		const rules = {
			isCasual: document.getElementById('basho-casual')?.checked || false,
			isBlitz: document.getElementById('basho-blitz')?.checked || false,
			maxBuild: parseInt(document.getElementById('basho-max-build')?.value || 4),
			cpuFill: document.getElementById('host-basho-cpufill').checked,
			cpuDiff: parseInt(document.getElementById('host-basho-cpu-diff').value)
		};

		const tourneyRef = db.collection("tournaments").doc();
		
		await tourneyRef.set({
			name: name,
			hostUID: window.currentUserUID,
			isPrivate: isPrivate,
			passcode: code,
			status: 'lobby', 
			rules: rules,
			maxPlayers: maxPlayers,
			currentRound: 0,
			schedule: {}, 
			players: {
				[window.currentUserUID]: {
					name: hostAlias,
					hosho: game.career.hosho_kin,
					cosmetics: game.playerCosmetics,
					loadout: game.playerLoadout,
					hairData: game.getExpAndHair ? game.getExpAndHair(true) : { stage: 1 },
					wins: 0,
					losses: 0,
					status: 'waiting' 
				}
			},
			createdAt: firebase.firestore.FieldValue.serverTimestamp()
		});

		document.getElementById('host-basho-modal').classList.add('hidden');
		this.joinBashoLobby(tourneyRef.id);
	},

	startBasho: async function() {
		if (!this.activeBashoId || !this.bashoData) return;
		
		const rules = this.bashoData.rules;
		
		const equalizeCheckbox = document.getElementById('basho-equalize');
		if (equalizeCheckbox) {
			rules.equalizeBuilds = equalizeCheckbox.checked;
		}
		
		let playersMap = { ...this.bashoData.players };
		
		if (rules.cpuFill) {
			const currentCount = Object.keys(playersMap).length;
			const needed = this.bashoData.maxPlayers - currentCount;
			const divData = game.DIVISIONS[rules.cpuDiff] || game.DIVISIONS[1];

			for (let i = 0; i < needed; i++) {
				const cpuId = `cpu_${Date.now()}_${i}`;
				const rankNum = Math.floor(Math.random() * 50) + 1;
				const side = Math.random() > 0.5 ? "East" : "West";
				
				game.currentOpponentName = "CPU"; 
				
				let cpuStage = 1;
				if (rules.cpuDiff >= 4) cpuStage = 4;
				else if (rules.cpuDiff >= 2) cpuStage = 2;
				
				playersMap[cpuId] = {
					name: `${divData.name} #${rankNum} ${side}`,
					isCPU: true,
					hosho: rules.cpuDiff * 100, 
					cosmetics: game.generateCPUCosmetics(rules.cpuDiff),
					loadout: game.generateCPULoadout(rules.cpuDiff),
					hairData: { stage: cpuStage },
					wins: 0,
					losses: 0,
					status: 'ready'
				};
			}
		}
		
		let uids = Object.keys(playersMap);
		if (uids.length % 2 !== 0) uids.push('BYE'); 
		
		const rounds = {}; 
		const numRounds = uids.length - 1;
		const numMatchesPerRound = uids.length / 2;

		for (let i = 0; i < numRounds; i++) {
			const roundPairings = [];
			for (let j = 0; j < numMatchesPerRound; j++) {
				roundPairings.push({
					p1: uids[j],
					p2: uids[uids.length - 1 - j],
					winner: null,
					matchId: `basho_${this.activeBashoId}_R${i}_M${j}`
				});
			}
			rounds[i] = roundPairings; 
			uids.splice(1, 0, uids.pop());
		}

		await db.collection("tournaments").doc(this.activeBashoId).update({
			players: playersMap, 
			status: 'playing',
			schedule: rounds,
			currentRound: 0,
			rules: rules 
		});
	},

	// --- JOINING ---
	pendingJoinTourneyId: null, 

	promptJoinPrivateBasho: function() {
		if (typeof sound !== 'undefined') sound.play('click');
		this.pendingJoinTourneyId = null; 
		document.getElementById('join-basho-alias-input').value = game.getLocalName();
		document.getElementById('join-basho-code-container').classList.remove('hidden'); 
		document.getElementById('join-basho-code-input').value = ''; 
		document.getElementById('join-basho-modal').classList.remove('hidden');
	},

	promptJoinPublicBasho: function(tourneyId) {
		if (typeof sound !== 'undefined') sound.play('click');
		this.pendingJoinTourneyId = tourneyId; 
		document.getElementById('join-basho-alias-input').value = game.getLocalName();
		document.getElementById('join-basho-code-container').classList.add('hidden'); 
		document.getElementById('join-basho-modal').classList.remove('hidden');
	},

	confirmJoinBasho: async function() {
		const joinAlias = document.getElementById('join-basho-alias-input').value.trim() || game.getLocalName();
		let targetId = this.pendingJoinTourneyId;

		if (!targetId) {
			const code = document.getElementById('join-basho-code-input').value.trim();
			if (!code) { alert("Please enter a passcode."); return; }
			
			const snapshot = await db.collection("tournaments")
				.where("passcode", "==", code)
				.where("status", "==", "lobby")
				.limit(1).get();

			if (snapshot.empty) { alert("No active tournament found with that passcode."); return; }
			targetId = snapshot.docs[0].id;
		}

		try {
			const tourneyRef = db.collection("tournaments").doc(targetId);
			
			const success = await db.runTransaction(async (transaction) => {
				const doc = await transaction.get(tourneyRef);
				if (!doc.exists || doc.data().status !== "lobby") throw "Tournament is no longer available.";
				
				const data = doc.data();
				const playerCount = Object.keys(data.players || {}).length;
				
				if (playerCount >= data.maxPlayers) throw "Tournament is already full!";

				const playerPath = `players.${window.currentUserUID}`;
				transaction.update(tourneyRef, {
					[playerPath]: {
						name: joinAlias, 
						hosho: game.career.hosho_kin,
						cosmetics: game.playerCosmetics,
						loadout: game.playerLoadout,
						hairData: game.getExpAndHair ? game.getExpAndHair(true) : { stage: 1 }, 
						wins: 0,
						losses: 0,
						status: 'waiting'
					}
				});
				return true;
			});

			if (success) {
				if (typeof sound !== 'undefined') sound.play('click');
				document.getElementById('join-basho-modal').classList.add('hidden');
				this.joinBashoLobby(targetId); 
			}
		} catch (err) {
			console.error("Join Error:", err);
			alert(typeof err === 'string' ? err : "An error occurred while joining.");
		}
	},

	joinBashoLobby: function(tourneyId) {
		this.activeBashoId = tourneyId;
		document.getElementById('basho-browser-screen').classList.add('hidden');
		document.getElementById('basho-lobby-screen').classList.remove('hidden');

		if (this.bashoUnsubscribe) {
			this.bashoUnsubscribe();
			this.bashoUnsubscribe = null;
		}

		this.bashoUnsubscribe = db.collection("tournaments").doc(tourneyId).onSnapshot(doc => {
			if (!doc.exists) {
				if (this.bashoUnsubscribe) {
					this.bashoUnsubscribe();
					this.bashoUnsubscribe = null;
				}
				this.activeBashoId = null;
				this.bashoData = null;

				alert("This tournament has been closed.");
				
				document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
				document.body.classList.remove('game-over-active');
				
				const onlineMenu = document.getElementById('online-menu');
				if (onlineMenu) onlineMenu.classList.remove('hidden');
				document.getElementById('online-main').classList.remove('hidden');
				
				if (typeof game !== 'undefined' && game.backToTitle) game.backToTitle();
				this.reset();
				return;
			}

			const data = doc.data();
			this.bashoData = data;
			const playersList = Object.keys(data.players);
			
			const hostName = data.players[data.hostUID] ? data.players[data.hostUID].name : "Unknown Host";
			document.getElementById('lobby-basho-name').innerText = data.name;
			document.getElementById('lobby-basho-host-label').innerText = `Hosted by: ${hostName}`;
			document.getElementById('lobby-player-count').innerText = `${playersList.length} / ${data.maxPlayers}`;

			document.getElementById('basho-casual').checked = data.rules.isCasual || false;
			document.getElementById('basho-blitz').checked = data.rules.isBlitz || false;
			document.getElementById('basho-max-build').value = data.rules.maxBuild !== undefined ? data.rules.maxBuild : 4;
			document.getElementById('basho-max-players').value = data.maxPlayers || 8;
			
			const equalizeEl = document.getElementById('basho-equalize');
			if (equalizeEl) {
				equalizeEl.checked = data.rules.equalizeBuilds || false;
			}

			const rosterContainer = document.getElementById('basho-player-list');
			let rosterHTML = "";

			console.group("🌸 BASHO LOBBY RENDER START");
			console.log("Global COSMETICS defined:", typeof window.COSMETICS !== 'undefined');

			playersList.forEach(uid => {
				const p = data.players[uid];
				const isHost = uid === data.hostUID;
				const cosmetics = p.cosmetics || {};
				
				let skinClass = "";
				let mawClass = "";
				if (window.COSMETICS) {
					skinClass = window.COSMETICS[cosmetics.skin]?.class || "";
					mawClass = window.COSMETICS[cosmetics.mawashi]?.class || "";
				}
				
				let stage = p.hairData ? p.hairData.stage : 1;
				const maxAllowed = data.rules.maxBuild !== undefined ? data.rules.maxBuild : 4;
				if (data.rules.equalizeBuilds) stage = maxAllowed;
				else if (stage > maxAllowed) stage = maxAllowed;
				
				let hairClass = (stage >= 4) ? "hair-oichomage" : (stage >= 2 ? "hair-chonmage" : "");
				const breatheDelay = -(Math.random() * 3).toFixed(2);
				
				rosterHTML += `
					<div style="background: rgba(0,0,0,0.05); padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
						<div style="display: flex; align-items: center; gap: 12px;">
							<div style="width: 40px; height: 40px; position: relative;">
								<div style="transform: scale(0.65); transform-origin: top left; position: absolute; top: 0; left: 0;">
									
									<div id="lobby-avatar-${uid}" class="rikishi ${hairClass} ${skinClass} ${mawClass}" style="--breathe-delay: ${breatheDelay}s;">
										<div class="top-knot"></div>
										
										<div class="mawashi-stripes"></div>
									</div>
									
								</div>
							</div>
							<span style="font-size: 1.1rem; padding-top: 5px;">${isHost ? '👑 ' : ''}<strong>${p.name}</strong></span>
						</div>
						<span style="color:var(--gold); font-family: var(--font-ui); font-weight: bold; font-size: 1.1rem; padding-top: 5px;">${p.hosho}¥</span>
					</div>`;
			});

			rosterContainer.innerHTML = rosterHTML;

			playersList.forEach(uid => {
				const p = data.players[uid];
				const avatarEl = document.getElementById(`lobby-avatar-${uid}`);
				
				if (avatarEl && p.loadout && typeof game !== 'undefined' && game.renderMawashiStripes) {
					game.renderMawashiStripes(avatarEl, p.loadout);
				}
			});
			
			console.groupEnd();

			const isHost = window.currentUserUID === data.hostUID;
			const settingsPanel = document.getElementById('basho-host-settings');
			const startBtn = document.getElementById('btn-start-basho');

			if (data.status === 'lobby') {
				
				if (isHost) {
					settingsPanel.style.opacity = "1";
					settingsPanel.style.pointerEvents = "auto";
					
					startBtn.classList.remove('hidden');
					
					const hasCpuFill = data.rules && data.rules.cpuFill;
					startBtn.disabled = (playersList.length < 2 && !hasCpuFill); 

					settingsPanel.onchange = () => this.updateBashoSettings();
				} else {
					settingsPanel.style.opacity = "0.6";
					settingsPanel.style.pointerEvents = "none";
					startBtn.classList.add('hidden');
				}

				document.getElementById('basho-results-screen').classList.add('hidden');
				document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
				document.body.classList.remove('game-over-active');
				
				if (typeof game !== 'undefined') {
					game.hideOverlays();
					if (game.resetAvatars) game.resetAvatars(true);
					
					const board = document.getElementById('game-board');
					if (board) board.classList.remove('cinematic-fatal', 'screen-tear');
					
					if (typeof BackgroundManager !== 'undefined') BackgroundManager.hide();
				}
				
				document.getElementById('basho-lobby-screen').classList.remove('hidden');
				
			} else if (data.status === 'playing') {
				this.handleBashoRound(data);
			} else if (data.status === 'finished') {
				this.showBashoResults(data);
			}
		}); 
	},

	updateBashoSettings: async function() {
		if (!this.activeBashoId || !this.bashoData) return;
		
		if (this.bashoData.hostUID !== window.currentUserUID) return;

		const maxPlayers = parseInt(document.getElementById('basho-max-players').value || 8);
		
		const equalizeEl = document.getElementById('basho-equalize');
		const equalizeVal = equalizeEl ? equalizeEl.checked : false;

		const rules = {
			isCasual: document.getElementById('basho-casual').checked,
			isBlitz: document.getElementById('basho-blitz').checked,
			maxBuild: parseInt(document.getElementById('basho-max-build').value),
			equalizeBuilds: equalizeVal, 
			cpuFill: this.bashoData.rules.cpuFill || false,
			cpuDiff: this.bashoData.rules.cpuDiff || 1
		};

		try {
			await db.collection("tournaments").doc(this.activeBashoId).update({
				maxPlayers: maxPlayers,
				rules: rules
			});
		} catch(e) {
			console.error("Failed to update tournament settings", e);
		}
	},

	reportBashoResult: async function(winnerUID, targetMatchId = null) {
		if (!this.activeBashoId) return;

		const tourneyRef = db.collection("tournaments").doc(this.activeBashoId);
		console.log(`[BASHO DEBUG] 🚀 reportBashoResult Fired! Winner: ${winnerUID} | Target: ${targetMatchId || 'My Match'}`);

		try {
			await db.runTransaction(async (transaction) => {
				const doc = await transaction.get(tourneyRef);
				if (!doc.exists) {
					console.log("[BASHO DEBUG] ❌ Tournament document disappeared!");
					return;
				}
				
				const data = doc.data();
				const roundIdx = data.currentRound;
				const schedule = JSON.parse(JSON.stringify(data.schedule)); 
				const roundData = schedule[roundIdx];

				let pairIdx = -1;
				if (targetMatchId) {
					pairIdx = roundData.findIndex(p => p.matchId === targetMatchId);
				} else {
					pairIdx = roundData.findIndex(p => p.p1 === window.currentUserUID || p.p2 === window.currentUserUID);
				}

				if (pairIdx === -1) {
					console.log(`[BASHO DEBUG] ❌ Match not found for user ${window.currentUserUID} or match ID ${targetMatchId}`);
					return; 
				}
				
				if (roundData[pairIdx].winner !== null) {
					console.log(`[BASHO DEBUG] 🛑 Match already has a winner recorded: ${roundData[pairIdx].winner}. Skipping.`);
					return; 
				}

				roundData[pairIdx].winner = winnerUID;
				console.log(`[BASHO DEBUG] ✅ Recorded win for ${winnerUID} in match ${roundData[pairIdx].matchId}`);

				const updatePayload = { schedule: schedule };

				if (winnerUID !== 'draw') {
					const currentWins = data.players[winnerUID].wins || 0;
					updatePayload[`players.${winnerUID}.wins`] = currentWins + 1;

					const loserUID = roundData[pairIdx].p1 === winnerUID ? roundData[pairIdx].p2 : roundData[pairIdx].p1;
					if (loserUID !== 'BYE') {
						const currentLosses = data.players[loserUID].losses || 0;
						updatePayload[`players.${loserUID}.losses`] = currentLosses + 1;
					}
				}

				const roundComplete = roundData.every(p => p.winner !== null);
				console.log(`[BASHO DEBUG] 🔍 Round Complete Check:`, roundData.map(p => `${p.p1} v ${p.p2} -> ${p.winner}`));
				
				if (roundComplete) {
					const totalRounds = Object.keys(schedule).length; 
					console.log(`[BASHO DEBUG] 🏁 All matches scored! Current Round: ${roundIdx + 1}/${totalRounds}`);
					
					if (roundIdx + 1 >= totalRounds) {
						console.log(`[BASHO DEBUG] 🏆 TOURNAMENT FINISHED! Pushing status update.`);
						
						if (winnerUID === window.currentUserUID) {
							const humanPlayers = Object.values(data.players).filter(p => !p.isCPU).length;
							if (humanPlayers >= 8 && typeof game !== 'undefined') {
								game.unlockAchievement('basho_fire');
							}
						}

						updatePayload.status = 'finished'; 
					} else {
						console.log(`[BASHO DEBUG] ➡️ Advancing to Round ${roundIdx + 1}`);
						updatePayload.currentRound = roundIdx + 1; 
					}
				}

				transaction.update(tourneyRef, updatePayload);
			});
		} catch (err) {
			console.error("[BASHO DEBUG] 🚨 Transaction failed:", err);
		}
	},

	rematchBasho: async function() {
		if (!this.activeBashoId || !this.bashoData) return;
		
		const updates = {
			status: 'lobby',
			schedule: {}, 
			currentRound: 0
		};

		Object.keys(this.bashoData.players).forEach(uid => {
			updates[`players.${uid}.wins`] = 0;
			updates[`players.${uid}.losses`] = 0;
			updates[`players.${uid}.status`] = 'waiting';
		});

		await db.collection("tournaments").doc(this.activeBashoId).update(updates);
	},

	handleBashoRound: async function(data) {
		if (data.status === 'finished') {
			this.bashoFinished = true; 
			this.bashoData = data; 
			
			const btn = document.getElementById('btn-post-action');
			const overlay = document.getElementById('post-match-overlay');
			
			if (btn && overlay && !overlay.classList.contains('hidden')) {
				btn.innerText = "TOURNAMENT COMPLETE (CONTINUE)";
				btn.classList.remove('pulsing-text');
				btn.disabled = false;
				btn.onclick = () => {
					this.leaveBashoLobby(); 
					if (typeof this.abortPromotionCeremony === 'function') this.abortPromotionCeremony();
					if (typeof this.playCinematicExit === 'function') {
						this.playCinematicExit(() => game.exitToMenu(), cinematicContext);
					} else if (typeof game.exitToMenu === 'function') {
						game.exitToMenu(); 
					}
				};
			}
			return; 
		}

		const roundData = data.schedule[data.currentRound];
		if (!roundData) return;

		const amIHost = data.hostUID === window.currentUserUID;
		
		const bashoHostData = data.players[data.hostUID];
		const bashoDohyo = (bashoHostData && bashoHostData.cosmetics && bashoHostData.cosmetics.dohyo) ? bashoHostData.cosmetics.dohyo : 'dohyo_default';
		
		if (typeof game !== 'undefined' && game.applyDohyoTheme) {
			game.applyDohyoTheme(bashoDohyo);
		}

		if (amIHost) {
			roundData.forEach(match => {
				if (match.winner === null && match.p1 !== 'BYE' && match.p2 !== 'BYE' && match.p1.startsWith('cpu_') && match.p2.startsWith('cpu_')) {
					const p1Data = data.players[match.p1];
					const p2Data = data.players[match.p2];
					
					console.log(`[BASHO DEBUG] 🤖 Host Auto-Scoring CPU Match: ${match.matchId}`);
					
					const p1Weight = 50 + ((p1Data.wins || 0) * 10);
					const p2Weight = 50 + ((p2Data.wins || 0) * 10);
					const roll = Math.random() * (p1Weight + p2Weight);
					const winner = roll < p1Weight ? match.p1 : match.p2;
					
					this.reportBashoResult(winner, match.matchId);
				}
			});
		}

		const myPairing = roundData.find(p => p.p1 === window.currentUserUID || p.p2 === window.currentUserUID);
		if (!myPairing) return; 

		if (myPairing.winner !== null) {
			if (!document.getElementById('post-match-overlay').classList.contains('hidden')) {
				 document.getElementById('post-match-res').innerHTML = "<div class='pulsing-text'>WAITING FOR OTHER MATCHES TO FINISH...</div>";
				 document.getElementById('btn-post-action').classList.add('hidden'); 
			}
			return;
		}

		if (myPairing.p1 === 'BYE' || myPairing.p2 === 'BYE') {
			this.reportBashoResult(window.currentUserUID); 
			return;
		}

		const opId = myPairing.p1 === window.currentUserUID ? myPairing.p2 : myPairing.p1;
		
		if (this.matchId === myPairing.matchId) return; 

		if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
		if (this.tempJoinSub) { this.tempJoinSub(); this.tempJoinSub = null; }
		this.handshakeComplete = false;
		this.oppBuildProcessed = false;
		this.oppTurnProcessed = -1;
		this.oppQTEProcessedTurn = -1;
		this.queuedMove = null;
		this.isBashoCPUMatch = false; 
		this.bashoCPUData = null;

		this.matchId = myPairing.matchId;

		if (opId.startsWith('cpu_')) {
			this.isBashoCPUMatch = true;
			this.bashoCPUData = data.players[opId];
			
			game.playerLoadout = data.players[window.currentUserUID].loadout || game.playerLoadout;
			game.cpuLoadout = this.bashoCPUData.loadout;
			
			const diff = data.rules.cpuDiff || 1;
			game.loadAI(diff); 
			
			const tempMap = { 'tutorial': 0.01, 0: 0.05, 1: 0.12, 2: 0.18, 3: 0.25, 4: 0.30, 5: 0.35 };
			game.currentAITemp = tempMap[diff] || 0.10;
			
			game.resetStats(); 
			game.hideOverlays();
			
			document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
			document.getElementById('build-screen').classList.remove('hidden');
			document.getElementById('build-msg').innerText = "STYLE SELECTION VS " + this.bashoCPUData.name;
			
			game.currentBuildMom = game.playerBuildMom !== undefined ? game.playerBuildMom : 1;
			if (typeof game.updateBuildUI === 'function') game.updateBuildUI();
			if (typeof game.renderTechGrid === 'function') game.renderTechGrid();
			
			return;
		}

		this.side = myPairing.p1 === window.currentUserUID ? 'host' : 'join';
		this.matchRules = data.rules;

		game.mode = 'online'; 

		document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
		
		if (this.side === 'host') {
			await db.collection("matches").doc(this.matchId).set({
				status: "waiting",
				hostUID: window.currentUserUID,
				rules: data.rules,
				hostData: {
					hosho: (game.career && game.career.hosho_kin) || 0,
					cosmetics: game.playerCosmetics || {},
					loadout: game.playerLoadout || ['strike', 'sweep', 'thrust', 'throw'],
					playerName: game.getLocalName() || "Rikishi"
				}
			});
			this.setupConn();
		} else {
			this.tempJoinSub = db.collection("matches").doc(this.matchId).onSnapshot(doc => {
				if (doc.exists && doc.data().status === 'waiting') {
					
					if (this.tempJoinSub) { this.tempJoinSub(); this.tempJoinSub = null; } 
					
					db.collection("matches").doc(this.matchId).update({
						status: "playing",
						joinData: {
							uid: window.currentUserUID,
							hosho: (game.career && game.career.hosho_kin) || 0,
							cosmetics: game.playerCosmetics || {},
							loadout: game.playerLoadout || ['strike', 'sweep', 'thrust', 'throw'],
							playerName: game.getLocalName() || "Rikishi"
						}
					});
					this.setupConn(); 
				}
			});
		}
	},

	showBashoResults: function(data) {
		document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
		document.getElementById('basho-results-screen').classList.remove('hidden');

		const playerArray = Object.keys(data.players).map(uid => {
			return { uid: uid, ...data.players[uid] };
		});

		playerArray.sort((a, b) => {
			if (b.wins !== a.wins) return b.wins - a.wins;
			if (a.losses !== b.losses) return a.losses - b.losses;
			return b.hosho - a.hosho;
		});

		const standingsContainer = document.getElementById('basho-standings-list');
		standingsContainer.innerHTML = '';

		const totalRounds = Object.keys(data.schedule || {}).length;

		playerArray.forEach((player, index) => {
			let rankStyle = "color: #fff;";
			let medal = "";
			
			if (index === 0) {
				rankStyle = "color: var(--gold); font-weight: bold; font-size: 1.2rem; text-shadow: 0 0 5px rgba(212,175,55,0.5);";
				medal = "🏆 ";
			} else if (index === 1) {
				rankStyle = "color: #c0c0c0; font-weight: bold; font-size: 1.1rem;"; 
				medal = "🥈 ";
			} else if (index === 2) {
				rankStyle = "color: #cd7f32; font-weight: bold; font-size: 1.05rem;"; 
				medal = "🥉 ";
			}

			let history = [];
			for (let r = 0; r < totalRounds; r++) {
				const roundData = data.schedule[r];
				if (roundData) {
					const match = roundData.find(p => p.p1 === player.uid || p.p2 === player.uid);
					if (match && match.winner && match.winner !== 'BYE' && match.winner !== null) {
						if (match.winner === player.uid) history.push('W');
						else if (match.winner !== 'draw') history.push('L');
					}
				}
			}

			let pipsHtml = `<div style="display: grid; grid-template-columns: repeat(${totalRounds}, 1fr); gap: 4px; padding: 6px; background: rgba(0,0,0,0.15); border-radius: 4px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.1);">`;
			for(let i = 0; i < totalRounds; i++) {
				let statusClass = '';
				if (i < history.length) {
					statusClass = history[i] === 'W' ? 'win' : 'loss';
				}
				pipsHtml += `<div class="hoshitori-pip anim-pip-${i}" data-status="${statusClass}"></div>`;
			}
			pipsHtml += `</div>`;

			standingsContainer.innerHTML += `
				<div style="display: flex; flex-direction: column; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; border-bottom: 1px solid rgba(255,255,255,0.1);">
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<div style="${rankStyle}">
							<span style="display: inline-block; width: 35px; opacity: 0.8;">#${index + 1}</span>
							<span>${medal}${player.name}</span>
						</div>
						<div style="font-family: var(--font-ui); text-align: right;">
							<span style="color: #27ae60; font-weight: bold; margin-right: 15px; font-size: 1.1rem;">${player.wins}W - ${player.losses}L</span>
							<span style="color: var(--gold); font-size: 0.9em; opacity: 0.8;">[${player.hosho}¥]</span>
						</div>
					</div>
					${pipsHtml}
				</div>
			`;
		});

		const isHost = window.currentUserUID === data.hostUID;
		if (isHost) {
			document.getElementById('host-post-basho-controls').classList.remove('hidden');
			document.getElementById('client-post-basho-exit').classList.add('hidden');
		} else {
			document.getElementById('host-post-basho-controls').classList.add('hidden');
			document.getElementById('client-post-basho-exit').classList.remove('hidden');
		}

		for (let i = 0; i < totalRounds; i++) {
			setTimeout(() => {
				let playedSound = false;
				
				document.querySelectorAll(`.anim-pip-${i}`).forEach(pip => {
					const status = pip.getAttribute('data-status');
					if (status) { 
						pip.classList.add(status, 'recent-pip');
						playedSound = true;
					}
				});
				
				if (playedSound && typeof sound !== 'undefined' && sound.enabled) {
					sound.play('calendar_drop'); 
				}
			}, 500 + (i * 350)); 
		}
	},

	disbandBasho: async function() {
		if (!this.activeBashoId) return;
		
		if (confirm("Are you sure you want to disband the tournament? This will kick all players.")) {
			const tourneyId = this.activeBashoId; 
			
			if (this.bashoUnsubscribe) {
				this.bashoUnsubscribe();
				this.bashoUnsubscribe = null;
			}
			this.activeBashoId = null;
			this.bashoData = null;

			try {
				await db.collection("tournaments").doc(tourneyId).delete();
			} catch(e) { 
				console.warn("Disband cleanup:", e); 
			}
			
			document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
			document.body.classList.remove('game-over-active'); 
			
			const onlineMenu = document.getElementById('online-menu');
			if (onlineMenu) onlineMenu.classList.remove('hidden');
			document.getElementById('online-main').classList.remove('hidden'); 
			
			this.reset(); 
		}
	},

	leaveBashoLobby: async function() {
		if (!this.activeBashoId) return;

		if (this.bashoData && this.bashoData.hostUID === window.currentUserUID) {
			this.disbandBasho();
			return;
		}

		const tourneyId = this.activeBashoId;

		if (this.bashoUnsubscribe) {
			this.bashoUnsubscribe();
			this.bashoUnsubscribe = null;
		}
		this.activeBashoId = null;
		this.bashoData = null;

		try {
			await db.collection("tournaments").doc(tourneyId).update({
				[`players.${window.currentUserUID}`]: firebase.firestore.FieldValue.delete()
			});
		} catch(e) { 
			console.log("Silent exit from basho"); 
		}

		document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
		document.body.classList.remove('game-over-active'); 
		
		const onlineMenu = document.getElementById('online-menu');
		if (onlineMenu) onlineMenu.classList.remove('hidden');
		document.getElementById('online-main').classList.remove('hidden');

		this.reset(); 
	}
};

const matchmaking = {
    findMatch: async function() {
        const queueRef = db.collection("matchmaking");
        
        // 1. Look for someone already waiting
        const snapshot = await queueRef.orderBy("createdAt", "asc").limit(1).get();

        if (!snapshot.empty) {
            // MATCH FOUND! 
            const lobby = snapshot.docs[0];
            const lobbyData = lobby.data();
            
            // Safety: Ensure we don't match with ourselves
            if (lobbyData.hostUID === currentUserUID) return;

            // Join the lobby
            await this.joinLobby(lobby.id, lobbyData);
        } else {
            // NO MATCH: Create a new lobby and wait
            await this.createLobby();
        }
    },

    createLobby: async function() {
        const lobbyId = `lobby_${currentUserUID}`;
        await db.collection("matchmaking").doc(lobbyId).set({
            hostUID: currentUserUID,
            hostName: game.getLocalName(),
            hostCosmetics: game.playerCosmetics,
            hostLoadout: game.playerLoadout,
            createdAt: Date.now(),
            status: "waiting"
        });

        // Start listening for someone to join
        this.listenForChallenger(lobbyId);
    },

    listenForChallenger: function(lobbyId) {
        const unsubscribe = db.collection("matchmaking").doc(lobbyId)
            .onSnapshot((doc) => {
                if (doc.exists && doc.data().status === "matched") {
                    unsubscribe();
                    this.startOnlineMatch(doc.data(), 'host');
                }
            });
    }
};

const originalBack = game.backToTitle;
game.backToTitle = function() {
    game.hideOverlays();
    document.getElementById('title-screen').classList.remove('hidden');
    
    const heyaBtn = document.getElementById('global-heya-btn');
    if (heyaBtn) {
        heyaBtn.classList.remove('hidden');
        // Let our centralized logic decide if the "NEW" pulsing should stay or go
        game.updateStableNotification(); 
    }
};

/* --- HELPER: Dynamic Control Positioning --- */
function updateControlsPosition(mode, activePlayer) {
    const controls = document.getElementById('controls');
    if (!controls) return;
    
    // Reset specific positioning classes
    controls.classList.remove('controls-left', 'controls-right');

    if (mode === 'online_guest') {
        // Online Guest: Always Right
        controls.classList.add('controls-right');
    } else if (mode === 'local') {
        // Local PvP: Switch based on turn
        if (activePlayer === 1) {
            controls.classList.add('controls-left');
        } else {
            controls.classList.add('controls-right');
        }
    } else {
        // Default (Single Player / CPU / Online Host / Tutorial): Always Left
        controls.classList.add('controls-left');
    }
}

// OUTSIDE OF GAME OBJECT FOR SAFETY
// OUTSIDE OF GAME OBJECT FOR SAFETY
game.playCinematicIntro = function() {
    const overlay = document.getElementById('cinematic-overlay');
    
    if (!overlay) {
        this.startTutorialGameLoop(); 
        return;
    }
    
    this.isCinematicActive = true;

    const oldQuote = document.getElementById('cinematic-quote');
    if (oldQuote) oldQuote.style.display = 'none';

    // --- ACT I: STAGING THE ELEMENTS ---
    const dohyo = document.querySelector('.dohyo-ring');
    const rikishiList = document.querySelectorAll('.rikishi');
    const huds = document.querySelectorAll('.hud-layer, #hud');
    const controls = document.querySelectorAll('#controls');
    const logArea = document.querySelectorAll('#log-area');

    if (dohyo) {
        dohyo.classList.remove('cinematic-hidden');
        dohyo.style.opacity = '1';
        dohyo.style.transform = 'scale(0.85)';
        dohyo.style.filter = 'brightness(0.15)'; 
        dohyo.style.transition = 'all 3.5s cubic-bezier(0.25, 1, 0.5, 1)';
    }

    rikishiList.forEach(el => {
        el.classList.remove('cinematic-hidden');
        el.style.opacity = '0';
        el.style.translate = '0 -150vh';
        el.style.scale = '1.1';
        el.style.transition = 'translate 0.5s cubic-bezier(0.5, 0, 1, 1), scale 0.5s ease-out, opacity 0.2s ease-in';
    });

    huds.forEach(el => {
        el.classList.remove('cinematic-hidden');
        el.style.opacity = '0';
        el.style.transform = 'translateY(40px) scale(0.95)';
        el.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    });

    controls.forEach(el => {
        el.classList.remove('cinematic-hidden');
        el.style.opacity = '0';
        el.style.transform = 'translateY(80px)';
        el.style.transition = 'all 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)';
    });

    logArea.forEach(el => {
        el.classList.remove('cinematic-hidden');
        el.style.opacity = '0';
        el.style.transform = 'translateY(-60px)';
        el.style.transition = 'all 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)';
    });

    // --- ACT II: THE CANVAS ENGINE ---
    overlay.classList.remove('hidden');
    overlay.style.display = 'block';
    overlay.style.backgroundColor = 'transparent';
    overlay.innerHTML = '<canvas id="cine-canvas" style="position:absolute; top:0; left:0; width:100%; height:100%; z-index:100; pointer-events:none;"></canvas>';

    const canvas = document.getElementById('cine-canvas');
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        if(canvas) { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    });

    let startTime = Date.now();
    let animId;
    let particles = [];
    let textDissolved = false;

    const quoteLine1 = "Practice as if it were the real tournament;";
    const quoteLine2 = "treat the real tournament as if it were practice.";
    const quoteAuthor = "– Futabayama Sadaji";

    for(let i=0; i<80; i++) {
        particles.push({
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 2 - 1,
            life: Math.random(), size: Math.random() * 3 + 1, isTextParticle: false
        });
    }

    const render = () => {
        if (!this.isTutorial) return;

        const elapsed = Date.now() - startTime;
        ctx.clearRect(0, 0, w, h);

        let overlayAlpha = 1;
        if (elapsed > 7000) overlayAlpha = Math.max(0, 1 - (elapsed - 7000) / 1500); 

        if (overlayAlpha > 0) {
            ctx.globalAlpha = overlayAlpha;
            ctx.fillStyle = '#05070d';
            ctx.fillRect(0, 0, w, h);

            // --- PUNCH THE TEXT HOLE ---
            if (!textDissolved && elapsed < 6500) {
                const scale = 1 + (elapsed / 25000);
                ctx.save(); ctx.translate(w/2, h/2); ctx.scale(scale, scale);

                let textAlpha = 1;
                if (elapsed < 1500) textAlpha = elapsed / 1500;
                else if (elapsed > 5500) textAlpha = Math.max(0, 1 - (elapsed - 5500) / 1000);

                ctx.globalAlpha = textAlpha;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                
                const fontSize = Math.min(w * 0.035, 32);

                // STEP 1: DRAW THE BORDER FIRST (Source-Over)
                // We draw it at 2px thick. The next step will erase the inner 1px.
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`; // The globalAlpha handles the fade
                ctx.lineWidth = 2; 
                ctx.lineJoin = 'round'; // Makes the corners of the text stroke look much smoother

                ctx.font = `italic 900 ${fontSize}px serif`;
                ctx.strokeText(quoteLine1, 0, -fontSize * 1.2);
                ctx.strokeText(quoteLine2, 0, fontSize * 0.4);

                ctx.font = `600 ${fontSize * 0.6}px sans-serif`;
                ctx.strokeText(quoteAuthor, 0, fontSize * 2.5);

                // STEP 2: PUNCH THE HOLE (Destination-Out)
                // This erases the black background AND the inside half of our stroke!
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = 'black'; // Color doesn't matter, only the alpha matters for destination-out

                ctx.font = `italic 900 ${fontSize}px serif`;
                ctx.fillText(quoteLine1, 0, -fontSize * 1.2);
                ctx.fillText(quoteLine2, 0, fontSize * 0.4);

                ctx.font = `600 ${fontSize * 0.6}px sans-serif`;
                ctx.fillText(quoteAuthor, 0, fontSize * 2.5);

                ctx.restore();
                ctx.globalCompositeOperation = 'source-over'; // Reset for the particles
            }
        }

        // --- TRIGGER DISSOLVE PARTICLES ---
        if (!textDissolved && elapsed > 5800) {
            textDissolved = true;
            for(let i=0; i<350; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 18 + 2;
                particles.push({
                    x: w/2 + (Math.random() - 0.5) * (w * 0.6),
                    y: h/2 + (Math.random() - 0.5) * 150,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 2, 
                    life: 1.0, decay: Math.random() * 0.02 + 0.01,
                    size: Math.random() * 4 + 1.5, isTextParticle: true
                });
            }
            if (typeof sound !== 'undefined') sound.play('shatter'); 
        }

        // --- DRAW PARTICLES ---
        ctx.globalAlpha = 1.0;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy;

            if (p.isTextParticle) {
                p.vy += 0.1; p.vx *= 0.96; 
                p.life -= p.decay;
                if (p.life <= 0) { particles.splice(i, 1); continue; }
                
                ctx.globalAlpha = p.life;
                ctx.fillStyle = `rgba(255, 215, 0, ${p.life})`;
                ctx.shadowBlur = 12; ctx.shadowColor = '#FFD700';
            } else {
                p.y -= 0.5; p.x += Math.sin(elapsed / 1000 + p.life * 10) * 0.5;
                if (p.y < 0) p.y = h;
                ctx.globalAlpha = overlayAlpha * 0.4;
                ctx.fillStyle = '#ffaa00'; ctx.shadowBlur = 0;
            }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;

        if (elapsed < 11000) {
            animId = requestAnimationFrame(render);
        } else {
            overlay.innerHTML = '';
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            this.isCinematicActive = false;
            if (this.bgState) this.bgState.introTimer = 0; 

            document.querySelectorAll('.rikishi, .dohyo-ring, .hud-layer, #hud, #controls, #log-area').forEach(el => {
                el.style.transition = ''; el.style.transform = ''; 
                el.style.translate = ''; el.style.scale = ''; 
                el.style.opacity = ''; el.style.filter = '';
            });

            this.startTutorialGameLoop();
        }
    };

    animId = requestAnimationFrame(render);

    // --- ACT III: THE DYNAMIC REVEAL ---
    setTimeout(() => {
        if (dohyo && this.isTutorial) {
            dohyo.style.filter = 'brightness(1)';
            dohyo.style.transform = 'scale(1)';
        }
    }, 5000);

    setTimeout(() => {
        if (!this.isTutorial) return;
        rikishiList.forEach((el, idx) => {
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.translate = '0 0px';
                el.style.scale = '1';
                setTimeout(() => {
                    if (typeof sound !== 'undefined') sound.play('boom');
                    document.body.classList.add('shake-active');
                    setTimeout(() => document.body.classList.remove('shake-active'), 300);
                }, 500); 
            }, idx * 400);
        });
    }, 7000);

    setTimeout(() => {
        if (!this.isTutorial) return;
        huds.forEach(el => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0) scale(1)';
        });
    }, 8500);

    setTimeout(() => {
        if (!this.isTutorial) return;
        controls.forEach(el => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
        logArea.forEach(el => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    }, 9000);
};

game.attachSmartClick = function(btn, clickAction) {
    let pressTimer = null;
    let isLongPress = false;

    // 1. Touch Start: Start the "Hold" timer
    btn.addEventListener('touchstart', (e) => {
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            // Activate the CSS tooltip
            btn.classList.add('touch-active'); 
            // Little vibration for feedback (Android only usually)
            if (navigator.vibrate) navigator.vibrate(40); 
        }, 400); // 400ms wait
    }, { passive: true });

    // 2. Touch End: Clean up
    btn.addEventListener('touchend', (e) => {
        clearTimeout(pressTimer);
        
        if (isLongPress) {
            // If it was a hold, prevent the click and hide tooltip after a delay
            e.preventDefault(); 
            setTimeout(() => btn.classList.remove('touch-active'), 1500);
        }
        // If it was a short tap, we do nothing here. 
        // The browser will naturally fire the 'click' event below.
    });

    // 3. The Click Handler
    btn.onclick = (e) => {
        // Only fire if we didn't just do a long press
        if (!isLongPress) {
            clickAction(e);
        }
    };
};

// Helper to start the game loop (refactored for safety)
game.startTutorialGameLoop = function() {
    sound.play('match_start');
    this.tutorialStep = 0;
    this.updateTutorial();
    this.updateHUD();
};

game.toggleSeason = function() {
	// 1. Define the chronological order of the Basho locations
	const seasons = ['tokyo', 'osaka', 'nagoya', 'fukuoka'];
	
	this.career.bashoIndex = ((this.career.bashoIndex || 0) + 1) % 6;
	
	// 2. Find the current season's index (default to tokyo if undefined)
	let currentIndex = seasons.indexOf(this.currentLocation);
	if (currentIndex === -1) currentIndex = 0;
	
	// 3. Increment the index, looping back to 0 if we hit the end of the array
	const nextIndex = (currentIndex + 1) % seasons.length;
	
	// 4. Update the game state
	this.currentLocation = seasons[nextIndex];
	
	// 5. HOUSEKEEPING: Clear the background state! 
	// This deletes the heavy cached canvases from the previous city to free up memory
	// and ensures the new city generates its props and caches completely fresh.
	this.bgState = {}; 
	
	// Optional: Reset the background elapsed time so waves/sun always start smoothly
	this.elapsed = 0; 
	
	console.log(`🏟️ Tour changed! Welcome to the ${this.currentLocation.toUpperCase()} Basho.`);
};

window.onload = () => game.init();

/* --- DEBUG TOOLS --- */
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'p') {
        const postMatchOverlay = document.getElementById('post-match-overlay');
        
        if (postMatchOverlay && !postMatchOverlay.classList.contains('hidden')) {
            // Grab a random division from your central array
            const randomRankIndex = Math.floor(Math.random() * game.DIVISIONS.length);
            const testRank = game.DIVISIONS[randomRankIndex];
            
            // Randomly select a move key from the ones we mapped earlier (plus a couple extras)
            const possibleMoves = ['hook', 'crush', 'trip', 'twist', 'nodowa', 'strike', 'utchari'];
            const randomMoveKey = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            
            // Pseudorandom booleans (50% chance to be true)
            const isFirstTime = Math.random() >= 0.5;
            const isPerfectClear = Math.random() >= 0.5;
            
            // Log the parameters so you know exactly which scenario you are testing
            console.log(`[DEBUG PROMOTION] Rank: ${testRank.name} | Move: ${randomMoveKey} | First Time: ${isFirstTime} | Perfect Clear: ${isPerfectClear}`);
            
            // Fire away with all 5 parameters!
            game.playPromotionCeremony(testRank.name, testRank.kanji, randomMoveKey, isFirstTime, isPerfectClear);
        }
    }
});

game.debugUnlockAll = function() {
    console.log("🔓 --- DEBUG: UNLOCKING EVERYTHING ---");

    // Failsafe: Ensure base objects exist if this is run on a totally fresh save
    if (!this.achievements) this.achievements = {};
    if (!this.stats) this.stats = {};
    if (!this.career) this.career = {};
    if (!this.career.stats) this.career.stats = { hoshoHistory: [] };

    // 1. UNLOCK ALL ACHIEVEMENTS (Badges)
    // This dynamically loops through BADGES, so all new rings and cosmetics unlock automatically!
    for (const key in BADGES) {
        this.achievements[key] = true;
    }
    console.log("✅ All Badges & Cosmetics unlocked.");

    // 2. UNLOCK ALL MOVES
    const allAttacks = Object.keys(MOVES).filter(k => MOVES[k].type.includes('atk'));
    this.career.unlockedMoves = [...allAttacks]; 
    console.log("✅ All Moves unlocked:", this.career.unlockedMoves);

    // 3. FILL WALLET & UPDATE HISTORY (Updated!)
    this.career.hosho_kin = 999999;
    if (!this.career.stats.hoshoHistory) this.career.stats.hoshoHistory = [];
    this.career.stats.hoshoHistory.push(999999); // Prevents the chart from breaking
    console.log("✅ Hōshōkin set to 999,999¥.");

    // 4. MAX OUT STATS (Updated for new features!)
    this.career.unlockedDiv = 5; 
    this.career.stats.highestDiv = 5;
    
    // --- NEW: Max out the new progression variables ---
    this.career.highestPerfectDiv = 5;       // Simulates Perfect Zensho-yusho
    this.stats.balance_checks_passed = 250;  // Simulates maximum QTE mastery
    
    // 5. SAVE & REFRESH
    this.saveStats();
    if (typeof this.saveCareer === 'function') this.saveCareer();
    
    // Force a UI refresh if the stable or records are open
    const stableScreen = document.getElementById('stable-screen');
    const recordsScreen = document.getElementById('records-overlay');
    
    if (stableScreen && !stableScreen.classList.contains('hidden')) {
        this.openStable(); 
    }
    if (recordsScreen && !recordsScreen.classList.contains('hidden')) {
        this.showRecords();
    }

    alert("⚡ DEBUG MODE: All Content Unlocked! \nCheck the Stable and Records.");
};

/* =========================================
   MAIN MENU TIPS & LORE SYSTEM
   ========================================= */
const tipSystem = {
    // Array of objects holding the type (Label) and the text
    tips: [
        // --- GAMEPLAY SYSTEM HINTS ---
        { type: "TACTIC", text: "Did you know you can use the WASDZXC keys to maneuver in combat? Try It!" },
        { type: "SYSTEM", text: "You can Press 'F' at any time to toggle game speed." },
        { type: "THE STABLE", text: "Selecting your loadout in the Stable configures your default loadout for every match." },
        { type: "PRESTIGE", text: "After Rebirthing, you will start in the highest Division which you reached CHAMPION status in last rebirth." },
        { type: "SURVIVAL", text: "You have a chance to stay upright if your Will is only barely exhausted by a fatal kimarite. NOKOTTA!" },

        // --- NEW: THE DECK & CARDS ---
        { type: "THE DECK", text: "Need a better hand? Swipe a card upward ⬆️ or press the 1-5 keys to discard it and draw a fresh one!" },
        { type: "THE DECK", text: "Want rarer, Legendary cards? Defeating higher-ranked opponents and climbing the Banzuke earns the best loot." },
        { type: "THE DECK", text: "Some cards have passive 'Hold' effects. They grant special defensive buffs or enable synergies just by sitting in your hand!" },
        { type: "THE DECK", text: "Don't just mash attacks! Managing your momentum and holding defensive cards can turn the tide against a stronger opponent." },
        { type: "THE DECK", text: "If you want to focus on a specific playstyle, try limiting your Deck in the Stable. A smaller deck means more consistent draws!" },

        // --- SUMO TRIVIA & HISTORY ---
        { type: "TRIVIA", text: "The referee (Gyoji) carries a short dagger (tanto) in his belt. Historically, this symbolized his willingness to commit seppuku if he made a wrong call!" },
        { type: "CULTURE", text: "A Rikishi's silk match belt (Mawashi) is never washed, only aired out in the sun. This preserves the silk and keeps their winning luck intact!" },
        { type: "TRIVIA", text: "Professional sumo wrestlers are legally forbidden from driving cars in Japan. They must use drivers, taxis, or public transit." },
        { type: "HISTORY", text: "The longest winning streak in modern sumo history is 69 consecutive matches, set by the legendary Yokozuna Futabayama in the 1930s." },
        { type: "CULTURE", text: "The heavy stomping (Shiko) performed by wrestlers isn't just a stretch; it is a Shinto ritual to crush and drive evil spirits from the ring." },
        { type: "TRIVIA", text: "A Kinboshi (Gold Star) is a massive honor awarded to a lower-ranked Maegashira who defeats a reigning Yokozuna, carrying a salary bonus for the rest of their career." },
        { type: "CULTURE", text: "Wrestlers eat a massive calorie-dense stew called 'Chanko Nabe' every day. Traditionally, chicken is preferred because a chicken stands on two legs—just like a victorious wrestler!" },
        { type: "TRIVIA", text: "There are no weight classes in professional Sumo. A 200-pound wrestler can absolutely be matched against a 400-pound giant!" },
        { type: "CULTURE", text: "The elaborate topknot (Oicho-mage) shaped like a ginkgo leaf isn't just for style—it acts as a shock absorber to protect the wrestler's head if they fall." },
        { type: "TRIVIA", text: "Only wrestlers in the top two divisions (Sekitori) are allowed to throw purifying salt before a match. Lower division wrestlers must fight without it." },
        { type: "TRIVIA", text: "Over 1,400 pounds (650 kg) of purifying salt is thrown by wrestlers over the course of a single 15-day Grand Sumo Tournament!" },
        { type: "HISTORY", text: "The clay ring (Dohyo) is considered sacred ground. A completely new ring is built by hand using specialized clay before every single tournament." },
        { type: "CULTURE", text: "When a wrestler retires, their topknot is ceremonially cut off in the 'Danpatsu-shiki'. Friends, family, and rivals each take a snip before the stablemaster makes the final cut." },
        { type: "TRIVIA", text: "The suspended roof above the ring is a replica of a Shinto shrine roof, symbolizing that the matches are dedicated to the gods." },
        { type: "HISTORY", text: "The legendary Edo-period wrestler Raiden won 254 matches and only lost 10 in his entire career, holding the highest win-rate in history at 96.2%." },
        
        // --- NEW: EXPANDED SUMO LORE ---
        { type: "CULTURE", text: "Life in a sumo stable is strictly hierarchical. Lower-ranked wrestlers must wake up earlier, clean, cook, and even bathe after the higher-ranked Sekitori." },
        { type: "TRIVIA", text: "The heavy white rope worn by a Yokozuna during their ring-entering ceremony is called a 'Tsuna'. It can weigh up to 44 pounds (20 kg)!" },
        { type: "CULTURE", text: "All professional sumo wrestlers must wear traditional Japanese clothing in public. The quality of the clothing is strictly dictated by their rank." },
        { type: "HISTORY", text: "A Yokozuna cannot be demoted. However, if they can no longer perform at the highest level, they are expected to honorably retire." },
        { type: "TRIVIA", text: "Matches usually end in seconds, but if a bout lasts over 4 minutes, the referee will pause it for a 'Mizu-iri' (water break) before resuming from the exact same position." },
        { type: "CULTURE", text: "Most wrestlers adopt a 'Shikona', or ring name. These names often evoke elements of nature like mountains, rivers, or dragons." },
        { type: "TRIVIA", text: "The Gyoji uses a solid wood war fan (Gunbai). At the end of a match, they point the fan toward the side of the victor." },
        { type: "HISTORY", text: "The legendary Hakuhō holds the all-time record for the most top-division championships, with an incredible 45 tournament victories!" },
        { type: "CULTURE", text: "Before the initial charge (Tachi-ai), both wrestlers must touch both fists to the ground. If they don't, it's a false start (Matta)!" },

        // --- WISDOM & QUOTES ---
        { type: "WISDOM", text: "“I will give my heart and soul to sumo.” — The traditional oath spoken by a Rikishi upon being promoted to Yokozuna." },
        { type: "WISDOM", text: "“Shin-Gi-Tai” (Heart, Technique, Body). A Yokozuna must embody all three to reach the pinnacle of the sport." },
        { type: "WISDOM", text: "“In sumo, you don't fight the opponent, you fight yourself.”<br> — Akebono Taro, the first foreign-born Yokozuna." },
        { type: "WISDOM", text: "“Fall down seven times, stand up eight.” — Traditional Japanese Proverb" },
        { type: "WISDOM", text: "“I look at the sea in front of me every day, so my heart is never tired.” — Rikishi Oho" }
    ],
    
    containerEl: null,
    textEl: null,
    labelEl: null,

    init: function() {
        this.containerEl = document.getElementById('main-menu-tip-container');
        this.textEl = document.getElementById('main-menu-tip-text');
        this.labelEl = document.getElementById('main-menu-tip-label');
        this.showRandomTip();
        this.setupObserver();
		BootManager.update('Consulting Oyokata (親方)...');
    },
	
	hideTip: function() {
        if (this.containerEl) {
            this.containerEl.style.display = 'none'; // Hides the box completely
        }
    },

    showRandomTip: function() {
        if (!this.textEl || !this.labelEl || !this.containerEl) return;
        
        // This ensures the box reappears if the player previously closed it!
        this.containerEl.style.display = 'flex';
		this.containerEl.style.flexDirection = 'column';
        
        // Fade out text
        this.textEl.style.opacity = 0;
        this.labelEl.style.opacity = 0;
        
        // Wait for fade, change text, fade in
        setTimeout(() => {
            const randomTip = this.tips[Math.floor(Math.random() * this.tips.length)];
            this.labelEl.innerHTML = `✦ ${randomTip.type} ✦`;
            this.textEl.innerHTML = randomTip.text;
            
            this.textEl.style.opacity = 1;
            this.labelEl.style.opacity = 1;
        }, 400); 
    },

    // Decoupled trigger: Watches the title screen and rolls a new tip when it appears
    setupObserver: function() {
        const titleScreen = document.getElementById('title-screen');
        if (!titleScreen) return;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // Title screen reappeared! Roll a new tip.
                    if (!titleScreen.classList.contains('hidden')) {
                        this.showRandomTip();
                    }
                }
            });
        });
        
        observer.observe(titleScreen, { attributes: true });
    },

    // Future-Proofing: Call this when you want to pull tips from a live server
    fetchLiveRepository: async function(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data && data.tips) {
                // Merges live tips with local tips
                this.tips = this.tips.concat(data.tips); 
            }
        } catch (e) {
            console.warn("Could not load live repository, using local tips.", e);
        }
    }
};

// Initialize the system once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    tipSystem.init();
});