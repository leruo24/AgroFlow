import { useMemo } from 'react';

import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppColors } from '@/constants/colors';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';

export default function HistoryScreen() {
  const { history } = useAgroFlow();
  const { colors } = useTheme();

  const styles = useMemo(
    () => createStyles(colors),
    [colors]
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <View style={styles.header}>
          <Text style={styles.title}>
            History
          </Text>

          <Text style={styles.subtitle}>
            Review irrigation and system activity across your farm.
          </Text>
        </View>

        {/* History summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>
            {history.length}
          </Text>

          <Text style={styles.summaryLabel}>
            Recorded Events
          </Text>
        </View>

        <Text style={styles.sectionTitle}>
          Recent Activity
        </Text>

        {/* Empty history message */}
        {history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No activity yet
            </Text>

            <Text style={styles.emptyText}>
              Irrigation actions and system events will appear here.
            </Text>
          </View>
        ) : (
          /* History cards */
          <View style={styles.historyList}>
            {history.map((item) => (
              <View
                key={item.id}
                style={styles.historyCard}
              >
                {/* Action, source and time */}
                <View style={styles.historyTop}>
                  <Text style={styles.actionTitle}>
                    {item.action}
                  </Text>

                  <View style={styles.historyMeta}>
                    <Text style={styles.source}>
                      {item.source}
                    </Text>

                    <Text style={styles.timestamp}>
                      {formatTimestamp(item.timestamp)}
                    </Text>
                  </View>
                </View>

                {/* Event description */}
                <Text style={styles.description}>
                  {item.description}
                </Text>

                {/* Zone and event type */}
                <View style={styles.historyFooter}>
                  <View style={styles.footerItem}>
                    <Text style={styles.footerLabel}>
                      Zone
                    </Text>

                    <Text style={styles.footerValue}>
                      {item.zone}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.footerItem,
                      styles.footerItemRight,
                    ]}
                  >
                    <Text style={styles.footerLabel}>
                      Event type
                    </Text>

                    <Text style={styles.footerValue}>
                      {formatType(item.type)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Changes the stored event type into text that is
 // easier for the farmer to understand.
 
function formatType(type: string) {
  if (type === 'override') {
    return 'Manual Override';
  }

  if (type === 'schedule') {
    return 'Schedule';
  }

  if (type === 'weather') {
    return 'Weather';
  }

  return 'Irrigation';
}

/*
 * Converts the timestamp into a shorter readable date.
 * Example: 15 Aug, 14:30
 */
function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);

  return date.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    
    container: {
      flex: 1,
      backgroundColor: colors.navigation,
    },

    page: {
      backgroundColor: colors.background,
    },

    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 35,
    },

    //Forest-green History header.
     
    header: {
      marginHorizontal: -18,
      marginBottom: 20,
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 6,
      backgroundColor: colors.navigation,
    },

    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.navigationText,
    },

    subtitle: {
      marginTop: 5,
      fontSize: 12,
      lineHeight: 20,
      color: colors.white,
    },
   
    summaryCard: {
      minHeight: 76,
      marginBottom: 25,
      padding: 12,
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    summaryValue: {
      fontSize: 21,
      fontWeight: '700',
      color: colors.secondaryDark,
    },

    summaryLabel: {
      marginTop: 4,
      fontSize: 10,
      color: colors.textSecondary,
    },

    sectionTitle: {
      marginBottom: 10,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },

    historyList: {
      gap: 12,
    },

    historyCard: {
      padding: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    
    historyTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },

    actionTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },

    historyMeta: {
      alignItems: 'flex-end',
    },

    source: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.primaryDark,
    },

    timestamp: {
      marginTop: 3,
      fontSize: 9,
      color: colors.textSecondary,
    },

    description: {
      marginTop: 7,
      marginBottom: 12,
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },

     
    historyFooter: {
      marginHorizontal: -14,
      marginBottom: -14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
    },

    footerItem: {
      flex: 1,
    },

    footerItemRight: {
      alignItems: 'flex-end',
    },

    footerLabel: {
      fontSize: 9,
      color: colors.text,
    },

    footerValue: {
      marginTop: 3,
      fontSize: 10,
      fontWeight: '600',
      color: colors.text,
    },

    emptyCard: {
      padding: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    emptyTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },

    emptyText: {
      marginTop: 5,
      fontSize: 11,
      lineHeight: 17,
      color: colors.textSecondary,
    },
  });
}