import { generateDashboardPdf } from '../exportPdf';

// Mock html2canvas and jsPDF for testing
jest.mock('html2canvas', () => ({
  default: jest.fn().mockResolvedValue({
    toDataURL: jest.fn().mockReturnValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
    width: 800,
    height: 600,
  }),
}));

jest.mock('jspdf', () => {
  const mockJsPDF = jest.fn().mockImplementation(() => ({
    addImage: jest.fn(),
    addPage: jest.fn(),
    save: jest.fn(),
    setFontSize: jest.fn(),
    setTextColor: jest.fn(),
    text: jest.fn(),
    internal: {
      pageSize: {
        getWidth: jest.fn().mockReturnValue(210),
        getHeight: jest.fn().mockReturnValue(297),
      },
    },
    getImageProperties: jest.fn().mockReturnValue({ width: 800, height: 600 }),
  }));
  return { default: mockJsPDF };
});

describe('generateDashboardPdf', () => {
  let mockElement;
  let mockNoPrintEls;

  beforeEach(() => {
    mockNoPrintEls = [];
    mockElement = {
      querySelectorAll: jest.fn().mockReturnValue(mockNoPrintEls),
      style: {},
    };
  });

  it('should generate a PDF with correct header information', async () => {
    const meta = {
      monthLabel: 'October 2026',
      municipality: 'All Municipalities',
      generatedAt: '2026-10-18 05:53:00',
    };

    await generateDashboardPdf(mockElement, meta);

    // Check that jsPDF was instantiated
    expect(require('jspdf').default).toHaveBeenCalledTimes(1);
    
    // Check header text was added
    const pdfInstance = require('jspdf').default.mock.instances[0];
    expect(pdfInstance.setFontSize).toHaveBeenCalledWith(18);
    expect(pdfInstance.setTextColor).toHaveBeenCalledWith(15, 23, 42);
    expect(pdfInstance.text).toHaveBeenCalledWith(
      'RoadMap Monthly Report: October 2026',
      10,
      18
    );
  });

  it('should handle multi-page rendering for large dashboards', async () => {
    // Mock canvas with large height
    const largeCanvas = {
      toDataURL: jest.fn().mockReturnValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
      width: 800,
      height: 2000,
    };
    
    // Override html2canvas mock
    require('html2canvas').default.mockResolvedValue(largeCanvas);
    
    const meta = {
      monthLabel: 'Test',
      municipality: 'All',
      generatedAt: 'Now',
    };

    await generateDashboardPdf(mockElement, meta);

    const pdfInstance = require('jspdf').default.mock.instances[0];
    // Should have called addPage at least once for multi-page
    expect(pdfInstance.addPage).toHaveBeenCalled();
  });

  it('should restore display styles after PDF generation', async () => {
    const mockEl1 = { style: { display: '' } };
    const mockEl2 = { style: { display: '' } };
    mockNoPrintEls.push(mockEl1, mockEl2);
    
    // Set initial display to none for testing
    mockEl1.style.display = 'none';
    mockEl2.style.display = 'none';
    
    await generateDashboardPdf(mockElement, {
      monthLabel: 'Test',
      municipality: 'All',
      generatedAt: 'Now',
    });
    
    // Should restore to empty string (default)
    expect(mockEl1.style.display).toBe('');
    expect(mockEl2.style.display).toBe('');
  });

  it('should reject on html2canvas failure', async () => {
    require('html2canvas').default.mockRejectedValue(new Error('Canvas error'));
    
    await expect(generateDashboardPdf(mockElement, {
      monthLabel: 'Test',
      municipality: 'All',
      generatedAt: 'Now',
    })).rejects.toThrow('Canvas error');
  });
});