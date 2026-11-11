// Android uses the native keychain; Web and Node SSR resolve the browser policy via Identity exports.
export { getItemAsync, setItemAsync, deleteItemAsync } from "expo-secure-store";
