import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: { main: '#007AFF', light: '#4DA3FF', dark: '#0055CC' },
    error: { main: '#FF3B30' },
    success: { main: '#34C759' },
    warning: { main: '#FF9F0A' },
    background: { default: '#F5F5F7', paper: '#FFFFFF' },
    text: { primary: '#1C1C1E', secondary: '#8E8E93' },
    divider: 'rgba(0,0,0,0.06)',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
    h4: { fontWeight: 600, fontSize: '1.5rem' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1rem' },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem' },
  },
  shadows: [
    'none',
    '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
    '0 2px 6px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
    '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
    '0 8px 24px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.04)',
    ...Array(21).fill('0 8px 24px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.04)'),
  ],
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          textTransform: 'none',
          fontWeight: 500,
          fontSize: '0.8125rem',
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        contained: {
          '&:hover': { boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
        },
        sizeSmall: { fontSize: '0.75rem', padding: '4px 10px' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          padding: '10px 16px',
          fontSize: '0.8125rem',
        },
        head: {
          fontWeight: 600,
          color: '#8E8E93',
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
          backgroundColor: '#FAFAFA',
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 6,
            fontSize: '0.875rem',
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: { borderRadius: 6, fontSize: '0.875rem' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500, fontSize: '0.75rem' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
  },
});

export default theme;
