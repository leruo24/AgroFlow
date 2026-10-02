// Drip: AgroFlow's raindrop helper. All four moods designed in ChatGPT.
// Requires react-native-svg (`npx expo install react-native-svg` if not installed).
import Svg, { G, Path, Ellipse } from 'react-native-svg';

export type DripMood = 'happy' | 'alert' | 'thirsty' | 'wave';
export const MASCOT_NAME = 'Drip';

const OUTLINE = '#176C86';
const BODY = '#72CBE8';
const SHADE = '#4FB4D3';
const FACE = '#184D35';

type Props = { mood?: DripMood; size?: number };

export default function Drip({ mood = 'happy', size = 64 }: Props) {
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
      <G id="body">
        <Path d="M50 7C42 19 28 35 23 53C18 74 29 98 50 108C71 98 82 74 77 53C72 35 58 19 50 7Z" fill={BODY} stroke={OUTLINE} strokeWidth={3.5} />
        <Path d="M27 77C32 94 42 103 50 107C59 103 68 94 73 77C62 84 38 84 27 77Z" fill={SHADE} opacity={0.48} />
        <Ellipse cx={36} cy={38} rx={5} ry={10} fill="#FFFFFF" opacity={0.62} />
      </G>
      <G id="leaf">
        <Path d="M50 13C51 7 55 3 63 4C61 12 57 16 50 16Z" fill="#2E7D5B" />
        <Path d="M51 14C54 10 57 8 60 7" fill="none" stroke={FACE} strokeWidth={1.8} />
      </G>

      {mood === 'happy' && (
        <G id="face">
          <Ellipse cx={41} cy={59} rx={3} ry={3.7} fill={FACE} />
          <Ellipse cx={59} cy={59} rx={3} ry={3.7} fill={FACE} />
          <Path d="M40 70C43 75 47 77 50 77C54 77 58 75 61 70" fill="none" stroke={FACE} strokeWidth={3} />
        </G>
      )}

      {mood === 'alert' && (
        <G id="face">
          <Path d="M36 49C39 47 43 47 46 49" fill="none" stroke={FACE} strokeWidth={2.4} />
          <Path d="M54 49C57 47 61 47 64 49" fill="none" stroke={FACE} strokeWidth={2.4} />
          <Ellipse cx={41} cy={59} rx={3.6} ry={4.8} fill={FACE} />
          <Ellipse cx={59} cy={59} rx={3.6} ry={4.8} fill={FACE} />
          <Ellipse cx={50} cy={73} rx={3.5} ry={4.4} fill={FACE} />
        </G>
      )}

      {mood === 'thirsty' && (
        <G id="face">
          <Path d="M36 52C39 49 43 49 46 51" fill="none" stroke={FACE} strokeWidth={2.4} />
          <Path d="M54 51C57 49 61 49 64 52" fill="none" stroke={FACE} strokeWidth={2.4} />
          <Ellipse cx={41} cy={60} rx={3} ry={3.7} fill={FACE} />
          <Ellipse cx={59} cy={60} rx={3} ry={3.7} fill={FACE} />
          <Path d="M41 76C44 72 47 71 50 71C54 71 57 72 60 76" fill="none" stroke={FACE} strokeWidth={3} />
        </G>
      )}

      {mood === 'wave' && (
        <>
          <G id="face">
            <Ellipse cx={41} cy={59} rx={3} ry={3.7} fill={FACE} />
            <Path d="M55 59C57 57 61 57 63 59" fill="none" stroke={FACE} strokeWidth={2.8} />
            <Path d="M40 70C43 75 47 77 50 77C54 77 58 75 61 70" fill="none" stroke={FACE} strokeWidth={3} />
          </G>
          <G id="arm">
            <Path d="M74 70C81 65 84 58 83 49" fill="none" stroke={OUTLINE} strokeWidth={4} />
            <Path d="M83 49L79 44M83 49L86 43M83 49L89 47" fill="none" stroke={OUTLINE} strokeWidth={2.8} />
          </G>
        </>
      )}
    </Svg>
  );
}
