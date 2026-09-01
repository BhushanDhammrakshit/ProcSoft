import { createTheme } from '@mui/material/styles';

// Standard enterprise-procurement look: neutral surfaces, a single accent color, dense tables.
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1A3C6E' },
    secondary: { main: '#2E7D32' },
    background: { default: '#F4F6F8' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: ['Inter', 'Roboto', 'Segoe UI', 'sans-serif'].join(','),
  },
  components: {
    MuiTableCell: { styleOverrides: { root: { fontSize: '0.875rem' } } },
  },
});
