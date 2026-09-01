import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPurchaseOrder, listPurchaseOrders } from '../api/purchaseOrders';

const columns: GridColDef[] = [
  { field: 'poNumber', headerName: 'PO #', flex: 0.8 },
  {
    field: 'supplier',
    headerName: 'Supplier',
    flex: 1,
    valueGetter: (value?: { legalName: string }) => value?.legalName,
  },
  { field: 'totalAmount', headerName: 'Total', flex: 0.6 },
  { field: 'currency', headerName: 'Currency', flex: 0.4 },
  { field: 'status', headerName: 'Status', flex: 0.6 },
];

export function PurchaseOrdersPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    supplierId: '',
    itemName: '',
    quantity: '1',
    unitPrice: '0',
    deliveryAddress: '',
    incoterms: '',
  });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders'], queryFn: listPurchaseOrders });

  const createMutation = useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setOpen(false);
    },
  });

  return (
    <Box>
      <Grid container justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Purchase Orders</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New Purchase Order
        </Button>
      </Grid>

      <Box sx={{ height: 600, bgcolor: 'white' }}>
        <DataGrid rows={data ?? []} columns={columns} loading={isLoading} getRowId={(row) => row.id} density="compact" />
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Purchase Order</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Supplier ID"
              helperText="Copy the supplier's ID from the Suppliers grid"
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            />
            <TextField label="Item Name" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
            <TextField
              label="Quantity"
              type="number"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <TextField
              label="Unit Price"
              type="number"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
            />
            <TextField
              label="Delivery Address"
              value={form.deliveryAddress}
              onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
            />
            <TextField
              label="Incoterms"
              placeholder="e.g. FOB, CIF"
              value={form.incoterms}
              onChange={(e) => setForm({ ...form, incoterms: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              createMutation.mutate({
                supplierId: form.supplierId,
                deliveryAddress: form.deliveryAddress,
                incoterms: form.incoterms,
                items: [
                  {
                    itemName: form.itemName,
                    quantity: Number(form.quantity),
                    unitPrice: Number(form.unitPrice),
                  },
                ],
              })
            }
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
