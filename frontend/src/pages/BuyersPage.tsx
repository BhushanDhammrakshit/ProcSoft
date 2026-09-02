import { useState } from 'react';
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
import { Buyer, createBuyer, searchBuyers } from '../api/buyers';

const columns: GridColDef<Buyer>[] = [
  { field: 'legalName', headerName: 'Buyer', flex: 1.2 },
  { field: 'email', headerName: 'Email', flex: 1 },
  { field: 'city', headerName: 'City', flex: 0.6 },
  { field: 'state', headerName: 'State', flex: 0.6 },
  { field: 'status', headerName: 'Status', flex: 0.6 },
  { field: 'verificationStatus', headerName: 'Verification', flex: 0.7 },
  {
    field: 'procurementCategories',
    headerName: 'Procures',
    flex: 1,
    renderCell: (params) => (
      <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
        {(params.value as Buyer['procurementCategories'])?.map((c) => (
          <Chip key={c} label={c} size="small" />
        ))}
      </Stack>
    ),
  },
];

export function BuyersPage() {
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    legalName: '',
    email: '',
    city: '',
    state: '',
    website: '',
    description: '',
    procurementCategories: '',
  });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['buyers', q],
    queryFn: () => searchBuyers({ q }),
  });

  const createMutation = useMutation({
    mutationFn: createBuyer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buyers'] });
      setAddOpen(false);
      setForm({ legalName: '', email: '', city: '', state: '', website: '', description: '', procurementCategories: '' });
    },
  });

  return (
    <Box>
      <Grid container justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Buyers</Typography>
        <Button variant="contained" onClick={() => setAddOpen(true)}>
          Add Buyer
        </Button>
      </Grid>

      <TextField
        placeholder="Search by name, email, city..."
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
        <DialogTitle>Add Buyer</DialogTitle>
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
              label="Website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
            <TextField
              label="About / Description"
              multiline
              minRows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <TextField
              label="Typically Procures (comma separated)"
              value={form.procurementCategories}
              onChange={(e) => setForm({ ...form, procurementCategories: e.target.value })}
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
                procurementCategories: form.procurementCategories
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
