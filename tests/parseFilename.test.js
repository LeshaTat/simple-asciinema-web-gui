const { parseFilenameDate } = require('../utils/parseFilename');

describe('parseFilenameDate function', () => {
  test('parses standard filename without tags', () => {
    const result = parseFilenameDate('asciinema_2025-04-04_13-56-53.cast');
    
    expect(result).not.toBeNull();
    expect(result.date).toBe('2025-04-04');
    expect(result.time).toBe('13:56:53');
    expect(result.tags).toEqual([]);
    expect(result.tagsString).toBe('');
    expect(result.dateObj).toBeInstanceOf(Date);
  });

  test('parses filename with single tag', () => {
    const result = parseFilenameDate('asciinema_2025-04-04_13-56-53_tags_work.cast');
    
    expect(result).not.toBeNull();
    expect(result.date).toBe('2025-04-04');
    expect(result.time).toBe('13:56:53');
    expect(result.tags).toEqual(['work']);
    expect(result.tagsString).toBe('work');
    expect(result.dateObj).toBeInstanceOf(Date);
  });

  test('parses filename with multiple tags', () => {
    const result = parseFilenameDate('asciinema_2025-04-04_13-56-53_tags_work-project-demo.cast');
    
    expect(result).not.toBeNull();
    expect(result.date).toBe('2025-04-04');
    expect(result.time).toBe('13:56:53');
    expect(result.tags).toEqual(['work', 'project', 'demo']);
    expect(result.tagsString).toBe('work, project, demo');
    expect(result.dateObj).toBeInstanceOf(Date);
  });

  test('returns null for invalid filename', () => {
    const result = parseFilenameDate('invalid_filename.cast');
    expect(result).toBeNull();
  });

  test('returns null for non-cast file', () => {
    const result = parseFilenameDate('asciinema_2025-04-04_13-56-53.txt');
    expect(result).toBeNull();
  });
});