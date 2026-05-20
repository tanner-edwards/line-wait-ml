import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type DayType = 'weekday' | 'weekend' | 'holiday';
type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

interface TimeTravelModalProps {
  visible: boolean;
  onSet: (at: string, label: string) => void;
  onResume: () => void;
}

// Fixed template dates: Tue May 5 (weekday), Sat May 2 (weekend), Sun May 10 Mother's Day (holiday)
const DATES: Record<DayType, string> = {
  weekday: '2026-05-05',
  weekend: '2026-05-02',
  holiday: '2026-05-10',
};

const TIMES: Record<TimeSlot, string> = {
  morning:   '09:00',
  afternoon: '13:00',
  evening:   '17:00',
  night:     '20:00',
};

const DAY_LABELS: Record<DayType, string> = {
  weekday: 'Weekday',
  weekend: 'Weekend',
  holiday: 'Holiday',
};

const TIME_LABELS: Record<TimeSlot, string> = {
  morning:   'Morning (9 AM)',
  afternoon: 'Afternoon (1 PM)',
  evening:   'Evening (5 PM)',
  night:     'Night (8 PM)',
};

const DAY_OPTIONS: DayType[] = ['weekday', 'weekend', 'holiday'];
const TIME_OPTIONS: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];

export function TimeTravelModal({ visible, onSet, onResume }: TimeTravelModalProps): React.ReactElement {
  const [dayType, setDayType] = useState<DayType>('weekday');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('morning');

  function handleSet() {
    // PDT fixed offset (-07:00) — parks are in Anaheim, CA; valid for May dates
    const at = `${DATES[dayType]}T${TIMES[timeSlot]}:00-07:00`;
    const label = `${TIME_LABELS[timeSlot].split(' (')[0]} · ${DAY_LABELS[dayType]}`;
    onSet(at, label);
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      {/* Backdrop — intentionally no onPress; user must use buttons to close */}
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Time Travel</Text>
          <Text style={styles.sectionLabel}>Day type</Text>
          <View style={styles.pills}>
            {DAY_OPTIONS.map(d => (
              <Pressable
                key={d}
                style={[styles.pill, dayType === d && styles.pillActive]}
                onPress={() => setDayType(d)}
                testID={`day-pill-${d}`}
              >
                <Text style={[styles.pillText, dayType === d && styles.pillTextActive]}>
                  {DAY_LABELS[d]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Time of day</Text>
          <View style={styles.pills}>
            {TIME_OPTIONS.map(t => (
              <Pressable
                key={t}
                style={[styles.pill, timeSlot === t && styles.pillActive]}
                onPress={() => setTimeSlot(t)}
                testID={`time-pill-${t}`}
              >
                <Text style={[styles.pillText, timeSlot === t && styles.pillTextActive]}>
                  {TIME_LABELS[t].split(' (')[0]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.setButton} onPress={handleSet} testID="time-travel-set">
            <Text style={styles.setButtonText}>Set</Text>
          </Pressable>
          <Pressable style={styles.resumeButton} onPress={onResume} testID="time-travel-resume">
            <Text style={styles.resumeButtonText}>Go to Present</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  pillActive: {
    backgroundColor: '#6b6bf5',
    borderColor: '#6b6bf5',
  },
  pillText: {
    fontSize: 13,
    color: '#444',
    fontWeight: '500',
  },
  pillTextActive: {
    color: '#fff',
  },
  setButton: {
    marginTop: 16,
    backgroundColor: '#222',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  setButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  resumeButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  resumeButtonText: {
    color: '#6b6bf5',
    fontSize: 14,
    fontWeight: '600',
  },
});
