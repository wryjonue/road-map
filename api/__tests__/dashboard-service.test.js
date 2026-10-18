import { getMonthlyReport } from '../dashboard-service';

// Mock D1 database
const mockDb = {
  prepare: jest.fn().mockReturnThis(),
  bind: jest.fn().mockReturnThis(),
  all: jest.fn(),
};

// Helper to set up mock results
function mockResults(results) {
  mockDb.all.mockResolvedValue({ results });
}

describe('getMonthlyReport', () => {
  beforeEach(() => {
    mockDb.all.mockClear();
    jest.clearAllMocks();
  });

  it('returns error for invalid month format', async () => {
    const result = await getMonthlyReport({}, 'invalid', 'all');
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: 'Month must be in YYYY-MM format' });
  });

  it('returns monthly report data with status breakdown', async () => {
    // Mock summary rows
    mockResults([
      { total: 120, resolved: 80, unresolved: 40 },
    ]);
    
    // Mock status rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { status: 'Open', count: 40 },
      { status: 'Resolved', count: 80 },
    ] });
    
    // Mock daily rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { day: '2026-10-01', count: 5 },
      { day: '2026-10-02', count: 8 },
    ] });
    
    // Mock previous month summary
    mockDb.all.mockResolvedValueOnce({ results: [
      { total: 107, resolved: 67 },
    ] });
    
    // Mock category rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { category_name: 'Road Accident', total: 50, resolved: 30, active: 20 },
    ] });
    
    // Mock location rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila', count: 60 },
    ] });
    
    // Mock municipality facet
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila' },
      { municipality: 'Quezon City' },
    ] });
    
    const result = await getMonthlyReport({ road_map_db: mockDb }, '2026-10', 'all');
    const json = await result.json();
    
    expect(json.month).toBe('2026-10');
    expect(json.total).toBe(120);
    expect(json.resolved).toBe(80);
    expect(json.unresolved).toBe(40);
    expect(json.byStatus).toHaveLength(2);
    expect(json.dailyReports).toHaveLength(2);
    expect(json.trends.totalChange).toBe(12.3);
    expect(json.trends.resolvedChange).toBe(20.0);
    expect(json.trends.rateChange).toBeCloseTo(5.0, 1);
    expect(json.previous.total).toBe(107);
    expect(json.municipalities).toEqual(['Manila', 'Quezon City']);
  });

  it('handles empty results gracefully', async () => {
    mockResults([]);
    
    // Mock empty status rows
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    // Mock empty daily rows
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    // Mock empty previous month
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    // Mock empty category rows
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    // Mock empty location rows
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    // Mock empty municipality facet
    mockDb.all.mockResolvedValueOnce({ results: [] });
    
    const result = await getMonthlyReport({ road_map_db: mockDb }, '2026-10', 'all');
    const json = await result.json();
    
    expect(json.total).toBe(0);
    expect(json.resolved).toBe(0);
    expect(json.unresolved).toBe(0);
    expect(json.byStatus).toEqual([]);
    expect(json.dailyReports).toEqual([]);
    expect(json.trends.totalChange).toBeNull();
    expect(json.previous.total).toBe(0);
    expect(json.municipalities).toEqual([]);
  });

  it('applies municipality filter correctly', async () => {
    mockResults([
      { total: 60, resolved: 40, unresolved: 20 },
    ]);
    
    // Mock status rows with filter
    mockDb.all.mockResolvedValueOnce({ results: [
      { status: 'Open', count: 20 },
      { status: 'Resolved', count: 40 },
    ] });
    
    // Mock daily rows with filter
    mockDb.all.mockResolvedValueOnce({ results: [
      { day: '2026-10-01', count: 3 },
    ] });
    
    // Mock previous month with filter
    mockDb.all.mockResolvedValueOnce({ results: [
      { total: 50, resolved: 30 },
    ] });
    
    // Mock category rows with filter
    mockDb.all.mockResolvedValueOnce({ results: [
      { category_name: 'Road Accident', total: 30, resolved: 20, active: 10 },
    ] });
    
    // Mock location rows with filter
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila', count: 60 },
    ] });
    
    // Mock municipality facet (unfiltered)
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila' },
      { municipality: 'Quezon City' },
    ] });
    
    const result = await getMonthlyReport({ road_map_db: mockDb }, '2026-10', 'Manila');
    const json = await result.json();
    
    expect(json.total).toBe(60);
    expect(json.byMunicipality).toEqual([{ municipality: 'Manila', count: 60 }]);
    expect(json.municipalities).toEqual(['Manila', 'Quezon City']);
  });

  it('handles date range edge cases (January/December)', async () => {
    // Test December to January transition
    mockResults([
      { total: 100, resolved: 70, unresolved: 30 },
    ]);
    
    // Mock status rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { status: 'Open', count: 30 },
      { status: 'Resolved', count: 70 },
    ] });
    
    // Mock daily rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { day: '2026-12-01', count: 5 },
    ] });
    
    // Mock previous month (November)
    mockDb.all.mockResolvedValueOnce({ results: [
      { total: 90, resolved: 60 },
    ] });
    
    // Mock category rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { category_name: 'Road Accident', total: 50, resolved: 35, active: 15 },
    ] });
    
    // Mock location rows
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila', count: 50 },
    ] });
    
    // Mock municipality facet
    mockDb.all.mockResolvedValueOnce({ results: [
      { municipality: 'Manila' },
    ] });
    
    const result = await getMonthlyReport({ road_map_db: mockDb }, '2026-12', 'all');
    const json = await result.json();
    
    expect(json.month).toBe('2026-12');
    expect(json.previous.total).toBe(90);
    expect(json.trends.totalChange).toBeCloseTo(11.1, 1);
  });
});