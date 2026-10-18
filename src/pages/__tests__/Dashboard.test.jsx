import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';

// Mock dependencies
jest.mock('@clerk/react', () => ({
  useAuth: jest.fn().mockReturnValue({
    getToken: jest.fn().mockResolvedValue('mock-token'),
    isLoaded: true,
    isSignedIn: true,
  }),
}));

jest.mock('../auth/roles', () => ({
  useAppRole: jest.fn().mockReturnValue({
    isLoaded: true,
    role: 'admin',
  }),
  canManageReports: jest.fn().mockReturnValue(true),
}));

jest.mock('chart.js', () => ({
  Chart: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
  })),
  register: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

describe('Dashboard', () => {
  beforeEach(() => {
    fetch.mockClear();
    
    // Mock successful API response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        month: '2026-10',
        total: 120,
        resolved: 80,
        unresolved: 40,
        trends: {
          totalChange: 12.3,
          resolvedChange: 20.0,
          rateChange: 5.0,
        },
        byStatus: [
          { status: 'Open', count: 40 },
          { status: 'Resolved', count: 80 },
          { status: 'Pending', count: 0 },
        ],
        dailyReports: [
          { day: '2026-10-01', count: 5 },
          { day: '2026-10-02', count: 8 },
        ],
        byCategory: [
          { name: 'Road Accident', total: 50, resolved: 30, active: 20 },
          { name: 'Damaged Road', total: 70, resolved: 50, active: 20 },
        ],
        byMunicipality: [
          { municipality: 'Manila', count: 60 },
          { municipality: 'Quezon City', count: 40 },
        ],
        municipalities: ['Manila', 'Quezon City', 'Cebu City'],
        previous: { total: 107, resolved: 67 },
      }),
    });
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    expect(screen.getByText('October 2026 overview')).toBeInTheDocument();
  });

  it('loads monthly report data and updates charts', async () => {
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    
    // Wait for data to load
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('80')).toBeInTheDocument();
    });
  });

  it('updates filter state when month selector changes', async () => {
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    
    // Find month selector and change it
    const monthSelect = screen.getByRole('combobox', { name: /select month/i });
    fireEvent.change(monthSelect, { target: { value: '2026-09' } });
    
    // Should trigger new fetch
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith(
        '/api/dashboard/monthly-report?month=2026-09&municipality=all',
        expect.any(Object)
      );
    });
  });

  it('updates filter state when municipality selector changes', async () => {
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    
    // Find municipality selector and change it
    const munSelect = screen.getByRole('combobox', { name: /filter by municipality/i });
    fireEvent.change(munSelect, { target: { value: 'Manila' } });
    
    // Should trigger new fetch
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith(
        '/api/dashboard/monthly-report?month=2026-10&municipality=Manila',
        expect.any(Object)
      );
    });
  });

  it('calls generateDashboardPdf when PDF button is clicked', async () => {
    const mockGeneratePdf = jest.fn();
    jest.spyOn(require('../utils/exportPdf'), 'generateDashboardPdf').mockImplementation(mockGeneratePdf);
    
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    
    // Wait for dashboard to load
    await waitFor(() => {
      expect(screen.getByText('120')).toBeInTheDocument();
    });
    
    // Click PDF button
    const pdfButton = screen.getByRole('button', { name: /pdf report/i });
    fireEvent.click(pdfButton);
    
    // Should call generateDashboardPdf
    await waitFor(() => {
      expect(mockGeneratePdf).toHaveBeenCalledTimes(1);
    });
  });

  it('shows loading state during data fetch', () => {
    render(
      <MemoryRouter>
        <Provider store={{ getState: jest.fn() }}>
          <Dashboard />
        </Provider>
      </MemoryRouter>
    );
    
    // Should show loading state initially
    expect(screen.getByText('Loading report metrics...')).toBeInTheDocument();
  });
});