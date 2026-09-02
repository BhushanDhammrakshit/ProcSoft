import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SuppliersPage } from './pages/SuppliersPage';
import { BuyersPage } from './pages/BuyersPage';
import { SupplierSearchPage } from './pages/SupplierSearchPage';
import { RfqPage } from './pages/RfqPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { MailingPage } from './pages/MailingPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/suppliers" replace />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/buyers" element={<BuyersPage />} />
        <Route path="/supplier-search" element={<SupplierSearchPage />} />
        <Route path="/rfqs" element={<RfqPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/mailing" element={<MailingPage />} />
      </Routes>
    </Layout>
  );
}
