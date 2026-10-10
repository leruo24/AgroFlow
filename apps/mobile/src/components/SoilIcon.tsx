import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

// The three soil-type icons, drawn with react-native-svg.
// The artwork is in apps/mobile/assets/soil/soil_{sandy,loam,clay}.svg. Importing an .svg
// as a component would need react-native-svg-transformer and a metro config, so the
// drawing commands are copied here unchanged, like components/mascot/Drip.tsx does for
// assets/mascot/drip_*.svg.

export type SoilIconKind = 'sandy' | 'loam' | 'clay';

type Props = { kind: SoilIconKind; size?: number };

export function SoilIcon({ kind, size = 48 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {kind === 'sandy' && (
        <>
          {/* Loose grains that water runs straight through, and a drop
              draining out of the bottom. */}
          <Rect
            x={6}
            y={30}
            width={88}
            height={62}
            rx={10}
            fill="#E8C98A"
            stroke="#9C7A3C"
            strokeWidth={3}
          />
          <Circle cx={22} cy={46} r={4} fill="#C9A35A" />
          <Circle cx={38} cy={52} r={3.5} fill="#B88F45" />
          <Circle cx={55} cy={44} r={4} fill="#C9A35A" />
          <Circle cx={72} cy={50} r={3.5} fill="#B88F45" />
          <Circle cx={84} cy={64} r={4} fill="#C9A35A" />
          <Circle cx={28} cy={70} r={4} fill="#B88F45" />
          <Circle cx={46} cy={76} r={3.5} fill="#C9A35A" />
          <Circle cx={64} cy={70} r={4} fill="#B88F45" />
          <Circle cx={18} cy={84} r={3} fill="#C9A35A" />
          <Circle cx={78} cy={84} r={3} fill="#B88F45" />
          <Path
            d="M50 8C46 14 42 19 42 23C42 27.5 45.5 30 50 30C54.5 30 58 27.5 58 23C58 19 54 14 50 8Z"
            fill="#72CBE8"
            stroke="#176C86"
            strokeWidth={2}
          />
          <Path
            d="M50 92V98M44 94L50 99L56 94"
            fill="none"
            stroke="#176C86"
            strokeWidth={2.5}
          />
        </>
      )}

      {kind === 'loam' && (
        <>
          {/* Crumbly clods with a seedling: the all-rounder. */}
          <Rect
            x={6}
            y={30}
            width={88}
            height={62}
            rx={10}
            fill="#8B5E3C"
            stroke="#5A3B22"
            strokeWidth={3}
          />
          <Ellipse cx={26} cy={48} rx={9} ry={6} fill="#6E4A2E" />
          <Ellipse cx={56} cy={46} rx={10} ry={6.5} fill="#6E4A2E" />
          <Ellipse cx={80} cy={56} rx={7} ry={5} fill="#6E4A2E" />
          <Ellipse cx={38} cy={70} rx={10} ry={6} fill="#6E4A2E" />
          <Ellipse cx={68} cy={76} rx={9} ry={6} fill="#6E4A2E" />
          <Ellipse cx={18} cy={80} rx={6} ry={4} fill="#6E4A2E" />
          <Path d="M50 30C50 22 46 16 40 14C42 21 45 26 50 30Z" fill="#2E7D5B" />
          <Path d="M50 30C50 21 55 15 62 13C60 21 56 26 50 30Z" fill="#2E7D5B" />
          <Path d="M50 30V18" stroke="#184D35" strokeWidth={2} />
        </>
      )}

      {kind === 'clay' && (
        <>
          {/* Cracks from drying out, and a drop sitting on the surface
              instead of soaking in. */}
          <Rect
            x={6}
            y={30}
            width={88}
            height={62}
            rx={10}
            fill="#B5654A"
            stroke="#7A3F2C"
            strokeWidth={3}
          />
          <Path
            d="M20 40L28 55L22 68M28 55L40 58"
            fill="none"
            stroke="#7A3F2C"
            strokeWidth={2.5}
          />
          <Path
            d="M62 38L58 52L70 62L66 80M70 62L84 66"
            fill="none"
            stroke="#7A3F2C"
            strokeWidth={2.5}
          />
          <Path d="M40 74L48 84" fill="none" stroke="#7A3F2C" strokeWidth={2.5} />
          <Path
            d="M50 8C46 14 42 19 42 23C42 27.5 45.5 30 50 30C54.5 30 58 27.5 58 23C58 19 54 14 50 8Z"
            fill="#72CBE8"
            stroke="#176C86"
            strokeWidth={2}
          />
          <Ellipse cx={50} cy={31} rx={10} ry={2.5} fill="#72CBE8" opacity={0.7} />
        </>
      )}
    </Svg>
  );
}
