import { Pressable, StyleSheet, Text, View } from "react-native";

export function OfflineView({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Couldn't reach Kimo</Text>
      <Text style={styles.body}>
        Check your internet connection, then try again.
      </Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: "#FDF8EE",
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2B2B2B",
  },
  body: {
    fontSize: 14,
    color: "#595858",
    textAlign: "center",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#2B2B2B",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
