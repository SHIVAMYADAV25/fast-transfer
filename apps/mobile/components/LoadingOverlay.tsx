import { ActivityIndicator, StyleSheet, View } from "react-native";

export function LoadingOverlay() {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <ActivityIndicator size="large" color="#2B2B2B" />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FDF8EE",
    alignItems: "center",
    justifyContent: "center",
  },
});
