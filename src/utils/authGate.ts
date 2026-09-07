import { entraAuthService } from '../services/entraAuthService';

/**
 * Minimal structural type instead of importing a concrete navigation prop
 * type (NativeStackNavigationProp vs the plain NavigationProp base type are
 * not structurally assignable to each other, so a concrete import here would
 * force every call site onto one specific navigator type) -- every screen
 * that calls this already has a `navigation.navigate('SignIn')`-capable prop.
 */
interface NavigatesToSignIn {
  navigate: (screen: 'SignIn') => void;
}

/**
 * Guards an action that needs a signed-in session (pack download, sync)
 * without gating the whole app behind sign-in -- capture/detection/review
 * must keep working fully offline with no account at all. Only the specific
 * screens that actually need connectivity anyway (PacksScreen's download,
 * SyncScreen's Sync All/Retry) call this first.
 *
 * Returns true if already signed in. Otherwise navigates to the SignIn
 * screen and returns false -- callers should stop the action they were
 * about to perform; the person retries it manually after signing in.
 */
export async function ensureSignedIn(navigation: NavigatesToSignIn): Promise<boolean> {
  if (await entraAuthService.isSignedIn()) {
    return true;
  }
  navigation.navigate('SignIn');
  return false;
}
