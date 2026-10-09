import { feedCategoryScope } from './feed-category-scope';

// R17-E — the one category rule for feed, detail and bid. A filter may only
// narrow the provider's own categories; it can never replace or widen them.
describe('feedCategoryScope', () => {
  it('no filter: exactly the provider categories', () => {
    expect(feedCategoryScope(['a', 'b'], undefined)).toEqual(['a', 'b']);
    expect(feedCategoryScope(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(feedCategoryScope(['a', 'b'], '')).toEqual(['a', 'b']);
  });

  it('a held category narrows to that category', () => {
    expect(feedCategoryScope(['a', 'b'], 'b')).toEqual(['b']);
  });

  it('a foreign category yields nothing, never itself', () => {
    expect(feedCategoryScope(['a'], 'c')).toEqual([]);
  });

  it('zero provider categories yields nothing, with or without a filter', () => {
    expect(feedCategoryScope([], undefined)).toEqual([]);
    expect(feedCategoryScope([], 'a')).toEqual([]);
  });

  it('returns a copy, so a caller cannot mutate the provider list', () => {
    const own = ['a'];
    const scope = feedCategoryScope(own, null);
    scope.push('z');
    expect(own).toEqual(['a']);
  });
});
