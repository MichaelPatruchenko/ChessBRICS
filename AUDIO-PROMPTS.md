# Audio Generation Prompts for BRICS Chess

## Sound direction

A quiet, modern chess hall with ceramic pieces and a wooden board. Keep the sounds short and dry. Generate each effect as a separate 48 kHz WAV file, free of voices, music, and long reverb tails. Leave peak headroom and trim any silence before the onset. Match the perceived loudness of sounds for actions of equal priority.

| File | Prompt |
| --- | --- |
| move.wav (A_single_short,_mute_#4-1793793205126.mp3) | A single short, muted tap of a ceramic chess piece on a wooden square. Soft attack, up to 180 ms. |
| capture.wav (Two_closely_spaced_i_#2-1793793280790.mp3) | Two closely spaced impacts. A light ceramic-on-ceramic click followed by a lower-pitched tap on the board. Up to 250 ms. |
| brics-jump.wav (A_brief_airy_sweep_f_#2-1793793319798.mp3) | A brief airy sweep followed by the clear, warm tap of a ceramic sphere on a pedestal landing on wood. Up to 350 ms. |
| castle.wav (Two_soft_wooden_taps_#1-1793793371885.mp3) | Two soft wooden taps at different pitches in quick succession, like two pieces being set down almost simultaneously. Up to 300 ms. |
| promotion.wav (Two_quiet,_rising_gl_#1-1793793400866.mp3) | Two quiet, rising glassy tones with a short decay. Up to 450 ms. |
| check.wav (A_dry_low_tone_follo_#3-1793793503491.mp3) | A dry low tone followed closely by a short, higher tone. A clear alert for check or a threatened king, free of piercing beeps. Up to 350 ms. |
| your-turn.wav (A_single_calm,_round_#1-1793793587791.mp3) | A single calm, rounded tone that remains distinct at low volume and tolerable when repeated. Up to 220 ms. |
| clock.wav (One_dry_click_from_a_#1-1793793693898.mp3, One_dry_click_from_a_#2-1793793697254.mp3) | One dry click from a mechanical chess clock. Quiet, up to 100 ms, with no rhythm or echo. |
| invalid.wav (Two_very_soft,_low_c_#1-1793793763033.mp3) | Two very soft, low clicks. Subtle feedback for an unavailable action. Up to 180 ms. |
| start.wav (A_short_rising_seque_#1-1793793790722.mp3) | A short rising sequence of two soft notes and a light wooden accent. Up to 600 ms. |
| king-capture.wav (The_crisp_impact_of__#1-1793793822522.mp3) | The crisp impact of a large ceramic piece on wood, followed by a low resonance that fades quickly. No breaking sound. Up to 550 ms. |
| victory.wav (A_short,_bright_thre_#2-1793793920734.mp3) | A short, bright three-note marimba cadence with a soft low accent. Up to 1.2 seconds. |
| draw.wav (Two_calm_notes_of_eq_#1-1793793960086.mp3) | Two calm notes of equal intensity that fade gently. Up to 1 second. |
| defeat.wav (Two_quiet_descending_#1-1793794001832.mp3) | Two quiet descending tones with a warm wooden timbre. Up to 1 second. |
| invite.wav (A_single_soft_glass__#1-1793794095305.mp3) | A single soft glass chime with a light wooden overtone. Up to 250 ms. |

## Lobby music

`lobby-loop.wav`. A seamless 64-second instrumental loop at 75 BPM, 20 bars in 4/4. Quiet chamber ambient music with sparse piano notes, soft marimba, and a warm, spacious background. Evoke a cozy chess club in the evening. Keep it free of vocals, recognizable musical quotations, drums, and sudden volume changes. Match phase and level at the loop boundary for a click-free transition. (Cozy Evening Chess Club.mp3, Evening Gambit.mp3)

## Match music

`match-loop.wav`. A seamless 80-second loop at 72 BPM, 24 bars in 4/4. Use nearly static harmony, a quiet string texture, and occasional soft notes. Leave room for move and clock sounds. Keep it free of vocals, regular ticking, end-of-loop crescendos, and harsh high frequencies. Deliver as a 48 kHz stereo WAV. (Silent Atmosphere.mp3, Static Horizon.mp3)

When integrating the audio, provide separate volume controls for effects and music. Start music after a player action so it does not interrupt their first game. Use short local files for events and seamless loops for music.
