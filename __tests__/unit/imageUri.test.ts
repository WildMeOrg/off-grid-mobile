import { toDisplayUri } from '../../src/utils/imageUri';

describe('toDisplayUri', () => {
  it('prepends file:// to a bare absolute path', () => {
    expect(
      toDisplayUri(
        '/data/user/0/org.ganesha.elebook.dev/files/observations/1/original.jpg',
      ),
    ).toBe(
      'file:///data/user/0/org.ganesha.elebook.dev/files/observations/1/original.jpg',
    );
  });

  it('leaves an existing file:// URI unchanged', () => {
    expect(toDisplayUri('file:///data/user/0/app/files/photo.jpg')).toBe(
      'file:///data/user/0/app/files/photo.jpg',
    );
  });

  it('leaves a content:// URI unchanged', () => {
    expect(toDisplayUri('content://media/external/images/media/42')).toBe(
      'content://media/external/images/media/42',
    );
  });

  it('leaves an http(s) URL unchanged', () => {
    expect(toDisplayUri('https://example.com/photo.jpg')).toBe(
      'https://example.com/photo.jpg',
    );
  });
});
