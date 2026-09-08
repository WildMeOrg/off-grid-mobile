jest.mock('../../../src/services/entraAuthService', () => ({
  entraAuthService: { isSignedIn: jest.fn() },
}));

import { ensureSignedIn } from '../../../src/utils/authGate';
import { entraAuthService } from '../../../src/services/entraAuthService';

const mockIsSignedIn = entraAuthService.isSignedIn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ensureSignedIn', () => {
  it('returns true and does not navigate when already signed in', async () => {
    mockIsSignedIn.mockResolvedValue(true);
    const navigate = jest.fn();

    const result = await ensureSignedIn({ navigate });

    expect(result).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to SignIn and returns false when not signed in', async () => {
    mockIsSignedIn.mockResolvedValue(false);
    const navigate = jest.fn();

    const result = await ensureSignedIn({ navigate });

    expect(result).toBe(false);
    expect(navigate).toHaveBeenCalledWith('SignIn');
  });
});
