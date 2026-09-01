import { PropsWithChildren } from 'react';
import {
  AppBar,
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import MailIcon from '@mui/icons-material/Mail';
import { Link, useLocation } from 'react-router-dom';

const drawerWidth = 240;

const navItems = [
  { label: 'Suppliers', path: '/suppliers', icon: <BusinessIcon /> },
  { label: 'AI Supplier Search', path: '/supplier-search', icon: <TravelExploreIcon /> },
  { label: 'RFQs', path: '/rfqs', icon: <RequestQuoteIcon /> },
  { label: 'Purchase Orders', path: '/purchase-orders', icon: <ReceiptLongIcon /> },
  { label: 'Bulk Mailing', path: '/mailing', icon: <MailIcon /> },
];

export function Layout({ children }: PropsWithChildren) {
  const location = useLocation();

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" noWrap>
            ProcSoft
          </Typography>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <List>
          {navItems.map((item) => (
            <ListItemButton
              key={item.path}
              component={Link}
              to={item.path}
              selected={location.pathname === item.path}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3, bgcolor: 'background.default', minHeight: '100vh' }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
