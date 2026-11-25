// Welcome screen: the app's front door. "Open" goes to the cases on this phone, where the
// settings icon (top right) leads to login, settings and sync.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, T } from "@/components/ui";
import { Space, TOUCH, useTheme } from "@/constants/theme";

export default function WelcomeScreen() {
  const t = useTheme();

  return (
    <SafeAreaView style={[local.screen, { backgroundColor: t.background }]}>
      <View style={local.hero}>
        <View style={[local.badge, { backgroundColor: t.primary }]}>
          <MaterialCommunityIcons
            name='microphone'
            size={56}
            color={t.onPrimary}
          />
        </View>
        <T variant='title' style={local.center}>
          VoiceDAR
        </T>
        <T style={[local.center, local.tagline]} color={t.muted}>
          Speak the crash report in Local Language. The app fills the eDAR form.
        </T>
      </View>

      <View style={local.actions}>
        <Button
          title='Open'
          onPress={() => router.push("/cases")}
          style={local.open}
        />
      </View>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1, padding: Space.lg, justifyContent: "space-between" },
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Space.sm,
  },
  badge: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Space.md,
  },
  center: { textAlign: "center" },
  tagline: { maxWidth: 320, marginTop: Space.sm },
  actions: { gap: Space.sm, paddingBottom: Space.md },
  open: { minHeight: TOUCH + 8 },
});
