/**
 * Cadena de efectos de audio con Web Audio API.
 * Aplica reverb, delay, chorus, distortion, filter y compressor al sonido del teclado.
 */

import type { Effect, EffectType } from '@/components/EffectsRack';

export interface AudioEffectsChain {
  input: GainNode;
  output: GainNode;
  updateEffects(effects: Effect[]): void;
  disconnect(): void;
}

function makeReverbIR(ctx: AudioContext, decaySeconds: number, preDelaySeconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.ceil((preDelaySeconds + decaySeconds) * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const preDelaySamples = Math.ceil(preDelaySeconds * sampleRate);
  for (let i = 0; i < length; i++) {
    if (i < preDelaySamples) data[i] = 0;
    else {
      const t = (i - preDelaySamples) / sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * (6 / decaySeconds));
    }
  }
  return buffer;
}

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const k = amount * 100;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function getFirstEffect(effects: Effect[], type: EffectType): Effect | undefined {
  return effects.find(e => e.type === type);
}

export function createAudioEffectsChain(ctx: AudioContext, destination: AudioNode): AudioEffectsChain {
  const inputGain = ctx.createGain();
  inputGain.gain.value = 1;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.knee.value = 30;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 20000;
  filter.Q.value = 1;

  const distortion = ctx.createWaveShaper();
  distortion.curve = makeDistortionCurve(0.3) as Float32Array<ArrayBuffer>;
  distortion.oversample = '4x';
  const distTone = ctx.createBiquadFilter();
  distTone.type = 'lowpass';
  distTone.frequency.value = 3000;
  const distWet = ctx.createGain();
  distWet.gain.value = 0;
  const distMerge = ctx.createGain();
  const distDry = ctx.createGain();
  distDry.gain.value = 1;

  const chorusDelay = ctx.createDelay(0.1);
  chorusDelay.delayTime.value = 0.015;
  const chorusLFO = ctx.createOscillator();
  chorusLFO.type = 'sine';
  chorusLFO.frequency.value = 1.5;
  const chorusLFOGain = ctx.createGain();
  chorusLFOGain.gain.value = 0.003;
  chorusLFO.connect(chorusLFOGain);
  chorusLFOGain.connect(chorusDelay.delayTime);
  chorusLFO.start();
  const chorusMerge = ctx.createGain();
  const chorusDry = ctx.createGain();
  chorusDry.gain.value = 1;
  const chorusWet = ctx.createGain();
  chorusWet.gain.value = 0;

  const delayNode = ctx.createDelay(2);
  delayNode.delayTime.value = 0.5;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.4;
  const delayMerge = ctx.createGain();
  const delayDry = ctx.createGain();
  delayDry.gain.value = 1;
  const delayWet = ctx.createGain();
  delayWet.gain.value = 0;

  const reverbConv = ctx.createConvolver();
  reverbConv.buffer = makeReverbIR(ctx, 2.5, 0.1);
  const reverbDry = ctx.createGain();
  const reverbWet = ctx.createGain();
  const reverbMerge = ctx.createGain();
  reverbDry.gain.value = 0.7;
  reverbWet.gain.value = 0.3;

  inputGain.connect(comp);
  comp.connect(filter);
  filter.connect(distDry);
  filter.connect(distortion);
  distortion.connect(distTone);
  distTone.connect(distWet);
  distDry.connect(distMerge);
  distWet.connect(distMerge);
  distMerge.connect(chorusDelay);
  distMerge.connect(chorusDry);
  chorusDelay.connect(chorusWet);
  chorusDry.connect(chorusMerge);
  chorusWet.connect(chorusMerge);
  chorusMerge.connect(delayNode);
  chorusMerge.connect(delayDry);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWet);
  delayDry.connect(delayMerge);
  delayWet.connect(delayMerge);
  delayMerge.connect(reverbDry);
  delayMerge.connect(reverbConv);
  reverbConv.connect(reverbWet);
  reverbDry.connect(reverbMerge);
  reverbWet.connect(reverbMerge);
  reverbMerge.connect(destination);

  function updateEffects(effects: Effect[]) {
    const compEffect = getFirstEffect(effects, 'compressor');
    if (compEffect) {
      if (compEffect.enabled) {
        const p = compEffect.parameters;
        comp.threshold.value = p.threshold ?? -20;
        comp.ratio.value = p.ratio ?? 4;
        comp.attack.value = p.attack ?? 0.003;
        comp.release.value = p.release ?? 0.25;
      } else {
        comp.threshold.value = 0;
        comp.ratio.value = 1;
      }
    }

    const filterEffect = getFirstEffect(effects, 'filter');
    if (filterEffect) {
      filter.frequency.value = filterEffect.enabled ? (filterEffect.parameters.frequency ?? 2000) : 20000;
      filter.Q.value = filterEffect.parameters.Q ?? 1;
    }

    const distEffect = getFirstEffect(effects, 'distortion');
    if (distEffect) {
      distortion.curve = makeDistortionCurve(distEffect.parameters.gain ?? 0.3) as Float32Array<ArrayBuffer>;
      const toneFreq = 400 + (distEffect.parameters.tone ?? 0.5) * 8000;
      distTone.frequency.value = toneFreq;
      const wet = distEffect.enabled ? (distEffect.parameters.wet ?? 0.2) : 0;
      distWet.gain.value = wet;
      distDry.gain.value = 1 - wet;
    }

    const chorusEffect = getFirstEffect(effects, 'chorus');
    if (chorusEffect) {
      if (chorusEffect.enabled) {
        const p = chorusEffect.parameters;
        chorusDelay.delayTime.setTargetAtTime(0.01 + (p.depth ?? 0.5) * 0.02, ctx.currentTime, 0.01);
        chorusLFO.frequency.value = p.rate ?? 1.5;
        chorusLFOGain.gain.value = 0.002 + (p.depth ?? 0.7) * 0.004;
        const wet = p.wet ?? 0.4;
        chorusWet.gain.value = wet;
        chorusDry.gain.value = 1 - wet;
      } else {
        chorusWet.gain.value = 0;
        chorusDry.gain.value = 1;
        chorusLFOGain.gain.value = 0;
      }
    }

    const delayEffect = getFirstEffect(effects, 'delay');
    if (delayEffect) {
      delayNode.delayTime.value = delayEffect.parameters.time ?? 0.5;
      delayFeedback.gain.value = delayEffect.parameters.feedback ?? 0.4;
      delayDry.gain.value = delayEffect.enabled ? (delayEffect.parameters.dry ?? 0.8) : 1;
      delayWet.gain.value = delayEffect.enabled ? (delayEffect.parameters.wet ?? 0.2) : 0;
    }

    const reverbEffect = getFirstEffect(effects, 'reverb');
    if (reverbEffect) {
      if (reverbEffect.enabled) {
        const p = reverbEffect.parameters;
        reverbConv.buffer = makeReverbIR(ctx, p.decay ?? 2.5, p.preDelay ?? 0.1);
        reverbDry.gain.value = p.dry ?? 0.7;
        reverbWet.gain.value = p.wet ?? 0.3;
      } else {
        reverbDry.gain.value = 1;
        reverbWet.gain.value = 0;
      }
    }
  }

  return {
    get input() { return inputGain; },
    get output() { return reverbMerge; },
    updateEffects,
    disconnect() {
      try { inputGain.disconnect(); } catch (_) {}
      try { reverbMerge.disconnect(); } catch (_) {}
      chorusLFO.stop();
    },
  };
}
