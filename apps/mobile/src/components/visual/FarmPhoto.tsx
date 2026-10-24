import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { agroflowImages, type AgroflowImage } from './agroflowImages';

export function FarmPhoto({image,height=96,compact=false}:{image:AgroflowImage;height?:number;compact?:boolean}) {
  const {colors}=useTheme();const {t}=useI18n();
  return <View testID="representative-photo" style={{gap:4,minWidth:0}}>
    <View style={{height,borderRadius:12,overflow:'hidden',backgroundColor:colors.surfaceSecondary}}>
      <Image source={agroflowImages[image]} style={StyleSheet.absoluteFill} contentFit="cover"
        transition={0} cachePolicy="memory-disk" priority="low" loading="lazy" accessibilityLabel="" accessible={false}/>
    </View>
    {!compact&&<Text style={{fontSize:12,lineHeight:18,color:colors.textSecondary}}>{t('visual.representativePhoto')}</Text>}
  </View>;
}
