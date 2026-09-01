import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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
import {
  Supplier,
  createSupplier,
  importSuppliersCsv,
  searchSuppliers,
} from '../api/suppliers';

const columns: GridColDef<Supplier>[] = [
  { field: 'legalName', headerName: 'Supplier', flex: 1.2 },
  { field: 'email', headerName: 'Email', flex: 1 },
  { field: 'city', headerName: 'City', flex: 0.6 },
  { field: 'state', headerName: 'State', flex: 0.6 },
  { field: 'rating', headerName: 'Rating', flex: 0.4 },
  { field: 'status', headerName: 'Status', flex: 0.6 },
  {
    field: 'categories',
    headerName: 'Categories',
    flex: 1,
    renderCell: (params) => (
      <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
        {(params.value as Supplier['categories'])?.map((c) => (
          <Chip key={c.id} label={c.name} size="small" />
        ))}
      </Stack>
    ),
  },
];

export function SuppliersPage() {
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ legalName: '', email: '', city: '', state: '', categoryNames: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', q],
    queryFn: () => searchSuppliers({ q, pageSize: 50 }),
  });

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setAddOpen(false);
      setForm({ legalName: '', email: '', city: '', state: '', categoryNames: '' });
    },
  });

  const importMutation = useMutation({
    mutationFn: importSuppliersCsv,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  return (
    <Box>
      <Grid container justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Suppliers</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
            Bulk Import CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importMutation.mutate(file);
            }}
          />
          <Button variant="contained" onClick={() => setAddOpen(true)}>
            Add Supplier
          </Button>
        </Stack>
      </Grid>

      <TextField
        placeholder="Search by name, email, city, state..."
        fullWidth
        size="small"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        sx={{ mb: 2, bgcolor: 'white' }}
      />

      <Box sx={{ height: 600, bgcolor: 'white' }}>
        <DataGrid
          rows={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          getRowId={(row) => row.id}
          density="compact"
        />
      </Box>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add Supplier</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Legal Name"
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
            <TextField
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <TextField
              label="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            <TextField
              label="Categories (comma separated)"
              value={form.categoryNames}
              onChange={(e) => setForm({ ...form, categoryNames: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              createMutation.mutate({
                ...form,
                categoryNames: form.categoryNames
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              })
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
