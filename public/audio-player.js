import {audioPath,playlists} from './audio-assets.js';

export function createAudio() {
  const music = new Audio();
  music.preload = 'none';
  let context, gain;
  let settings = {effects:false,music:false,effectsVolume:.65,musicVolume:.3};
  let activated = false;
  let scene = 'lobby';
  let track = 0;
  let playingTrack;
  let scheduled = Promise.resolve();
  let nextStart = 0;
  const buffers = new Map();

  function syncMusic() {
    if (!activated || !settings.music || document.hidden) {
      music.pause();
      return;
    }
    const name = playlists[scene][track];
    if (playingTrack !== name) {
      playingTrack = name;
      music.src = audioPath(name);
    }
    if (music.paused) music.play().catch(() => {});
  }
  music.addEventListener('ended',() => {
    track = (track + 1) % playlists[scene].length;
    syncMusic();
  });
  document.addEventListener('visibilitychange',syncMusic);

  function activate() {
    activated = true;
    if (settings.effects && window.AudioContext) {
      if (!context) {
        context = new AudioContext();
        gain = context.createGain();
        gain.connect(context.destination);
      }
      gain.gain.value = settings.effectsVolume;
      if (context.state === 'suspended') context.resume().catch(() => {});
    }
    syncMusic();
  }

  function effect(name) {
    if (!settings.effects || !context || document.hidden) return;
    if (!buffers.has(name)) {
      buffers.set(name,fetch(audioPath(name))
        .then(response => {
          if (!response.ok) throw new Error('Audio unavailable');
          return response.arrayBuffer();
        })
        .then(bytes => context.decodeAudioData(bytes))
        .catch(() => { buffers.delete(name); return null; }));
    }
    const pending = buffers.get(name);
    scheduled = scheduled.then(async () => {
      const buffer = await pending;
      if (!buffer || !settings.effects || document.hidden || context.state !== 'running') return;
      const now = context.currentTime;
      if (nextStart > now + 1) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const start = Math.max(now,nextStart);
      source.start(start);
      nextStart = start + buffer.duration + .04;
    }).catch(() => {});
  }
  return {
    activate,effect,
    configure(values) {
      settings = values;
      music.volume = values.musicVolume;
      if (gain) gain.gain.value = values.effects ? values.effectsVolume : 0;
      syncMusic();
    },
    setScene(next) {
      if (scene === next) return;
      scene = next;
      track = 0;
      syncMusic();
    }
  };
}
