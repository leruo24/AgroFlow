// Drip: AgroFlow's raindrop helper, redrawn as four native SVG moods.
import type { ReactNode, ReactElement } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

export type DripMood = 'happy' | 'alert' | 'thirsty' | 'wave';
export const MASCOT_NAME = 'Drip';

const OUTLINE = '#0759B8';
const FACE = '#052A67';
const CHEEK = '#319FEF';

type Props = { mood?: DripMood; size?: number };
type MoodProps = { size: number };
type ShellProps = MoodProps & { raisedArm?: boolean; children: ReactNode };

function DripShell({ size, raisedArm = false, children }: ShellProps) {
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
      <Defs>
        <LinearGradient id="body" x1="25" y1="14" x2="73" y2="105" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#B7F4FF" />
          <Stop offset="0.5" stopColor="#78D7F7" />
          <Stop offset="1" stopColor="#37A5F2" />
        </LinearGradient>
        <LinearGradient id="arm" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A9EEFF" />
          <Stop offset="1" stopColor="#48B8F4" />
        </LinearGradient>
        <RadialGradient id="faceGlow" cx="50%" cy="43%" rx="55%" ry="58%">
          <Stop offset="0" stopColor="#D9FAFF" stopOpacity={0.58} />
          <Stop offset="1" stopColor="#8BE5FA" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      <Path
        d="M27 87C21 86 16 89 12 94C8 100 8 107 13 110C18 113 25 109 30 101"
        fill="url(#arm)"
        stroke={OUTLINE}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {raisedArm ? (
        <Path
          d="M73 89C79 86 82 80 82 73C82 67 86 63 91 64C97 65 99 71 97 77C94 87 87 94 78 98"
          fill="url(#arm)"
          stroke={OUTLINE}
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M72 87C79 86 85 89 89 94C93 100 92 107 87 110C82 113 75 109 70 101"
          fill="url(#arm)"
          stroke={OUTLINE}
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      <Ellipse cx={39} cy={108} rx={8} ry={5.5} fill="url(#arm)" stroke={OUTLINE} strokeWidth={3} />
      <Ellipse cx={62} cy={108} rx={8} ry={5.5} fill="url(#arm)" stroke={OUTLINE} strokeWidth={3} />
      <Path
        d="M50 5C43 20 23 42 18 65C13 88 27 105 50 106C73 105 87 88 82 65C77 42 57 20 50 5Z"
        fill="url(#body)"
        stroke={OUTLINE}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <Path
        d="M24 70C25 88 36 99 51 100C66 99 76 90 79 75C67 85 38 88 24 70Z"
        fill="#248DE8"
        opacity={0.22}
      />
      <Ellipse cx={50} cy={63} rx={29} ry={35} fill="url(#faceGlow)" />
      <Path d="M41 20C34 31 27 43 24 56" fill="none" stroke="#E8FCFF" strokeWidth={4.5} strokeLinecap="round" opacity={0.82} />
      <Ellipse cx={30} cy={48} rx={4.4} ry={8.5} fill="#FFFFFF" opacity={0.92} transform="rotate(28 30 48)" />
      <Ellipse cx={25.5} cy={61} rx={2.4} ry={4.5} fill="#FFFFFF" opacity={0.72} transform="rotate(30 25.5 61)" />
      <Path d="M59 22C61 37 66 48 74 57" fill="none" stroke="#2A9FEA" strokeWidth={6} strokeLinecap="round" opacity={0.26} />
      <Ellipse cx={76} cy={68} rx={3.2} ry={8} fill="#D8F8FF" opacity={0.7} transform="rotate(-20 76 68)" />

      {children}
    </Svg>
  );
}

function Eye({ cx, worried = false }: { cx: number; worried?: boolean }) {
  return (
    <G>
      {worried ? (
        <Path d={cx < 50 ? `M${cx - 7} 62Q${cx} 58 ${cx + 7} 57` : `M${cx - 7} 57Q${cx} 58 ${cx + 7} 62`} fill={FACE} />
      ) : null}
      <Ellipse cx={cx} cy={70} rx={7.5} ry={10} fill={FACE} />
      <Ellipse cx={cx + 1.7} cy={66.5} rx={2.2} ry={3} fill="#FFFFFF" />
      <Path d={`M${cx - 4} 73Q${cx - 5} 78 ${cx - 1} 80`} fill="none" stroke="#0DB7FF" strokeWidth={2.2} strokeLinecap="round" />
    </G>
  );
}

function Cheeks() {
  return (
    <G opacity={0.7}>
      <Ellipse cx={30} cy={82} rx={5} ry={2.8} fill={CHEEK} />
      <Ellipse cx={70} cy={82} rx={5} ry={2.8} fill={CHEEK} />
    </G>
  );
}

function HappyFace({ waving = false }: { waving?: boolean }) {
  return (
    <G>
      <Path d="M32 59Q38 55 43 58" fill="none" stroke={FACE} strokeWidth={3} strokeLinecap="round" />
      <Path d="M57 58Q63 55 69 59" fill="none" stroke={FACE} strokeWidth={3} strokeLinecap="round" />
      <Eye cx={39} />
      {waving ? (
        <Path d="M56 70Q62 66 68 70" fill="none" stroke={FACE} strokeWidth={3.2} strokeLinecap="round" />
      ) : (
        <Eye cx={62} />
      )}
      <Cheeks />
      <Path d="M43 86Q50 93 58 86" fill="none" stroke={FACE} strokeWidth={3.5} strokeLinecap="round" />
    </G>
  );
}

function HappyDrip({ size }: MoodProps) {
  return <DripShell size={size}><HappyFace /></DripShell>;
}

function WaveDrip({ size }: MoodProps) {
  return <DripShell size={size} raisedArm><HappyFace waving /></DripShell>;
}

function AlertDrip({ size }: MoodProps) {
  return (
    <DripShell size={size}>
      <Path d="M31 58Q37 53 43 58M57 58Q63 53 69 58" fill="none" stroke={FACE} strokeWidth={3.2} strokeLinecap="round" />
      <Eye cx={39} worried />
      <Eye cx={62} worried />
      <Cheeks />
      <Path d="M45 89Q50 82 55 89Q55 94 50 94Q45 94 45 89Z" fill={FACE} />
      <Path d="M47.5 91Q50 88.5 52.5 91" fill="none" stroke="#68C8F5" strokeWidth={1.4} strokeLinecap="round" />
    </DripShell>
  );
}

function ThirstyDrip({ size }: MoodProps) {
  return (
    <DripShell size={size}>
      <Path d="M31 59Q37 63 43 57M57 57Q63 63 69 59" fill="none" stroke={FACE} strokeWidth={3.2} strokeLinecap="round" />
      <Eye cx={39} worried />
      <Eye cx={62} worried />
      <Cheeks />
      <Path d="M43 88Q50 83 57 88Q56 93 51 94Q46 94 43 88Z" fill={FACE} />
      <Path d="M48 89C42 91 43 99 49 100C55 100 57 94 55 90C53 88 50 88 48 89Z" fill="#F27891" stroke="#A7375B" strokeWidth={1.5} />
      <Circle cx={47.5} cy={96.5} r={1.2} fill="#FFC2CF" />
      <Path d="M75 53C72 58 70 61 70 65C70 69 72 71 75 71C79 71 81 68 80 65C80 61 78 58 75 53Z" fill="#C8F6FF" stroke={OUTLINE} strokeWidth={2} />
      <Path d="M74 59Q72.5 63 73.5 66" fill="none" stroke="#FFFFFF" strokeWidth={1.4} strokeLinecap="round" />
    </DripShell>
  );
}

const MOODS: Record<DripMood, (props: MoodProps) => ReactElement> = {
  happy: HappyDrip,
  alert: AlertDrip,
  thirsty: ThirstyDrip,
  wave: WaveDrip,
};

export default function Drip({ mood = 'happy', size = 64 }: Props) {
  const Mood = MOODS[mood];
  return <Mood size={size} />;
}
