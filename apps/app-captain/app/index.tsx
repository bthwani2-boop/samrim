import { StyleSheet, Text, View } from "react-native";

export default function FoundationHome() {
  return <View style={styles.container}><Text style={styles.title}>BThwani Captain</Text><Text style={styles.status}>Foundation Ready</Text></View>;
}

const styles = StyleSheet.create({ container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, title: { fontSize: 24, fontWeight: "700" }, status: { marginTop: 8, fontSize: 16 } });
