import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRfq, draftRfqFromPrompt, listRfqs } from '../api/rfq';

const columns: GridColDef[] = [
  { field: 'rfqNumber', headerName: 'RFQ #', flex: 0.8 },
  { field: 'title', headerName: 'Title', flex: 1.4 },
  { field: 'category', headerName: 'Category', flex: 0.8 },
  { field: 'status', headerName: 'Status', flex: 0.6 },
  {
    field: 'dueDate',
    headerName: 'Due Date',
    flex: 0.8,
    valueFormatter: (value?: string) => (value ? new Date(value).toLocaleDateString() : ''),
  },
];

export function RfqPage() {
  const [open, setOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    dueDate: '',
    itemName: '',
    quantity: '1',
  });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['rfqs'], queryFn: listRfqs });

  const draftMutation = useMutation({
    mutationFn: draftRfqFromPrompt,
    onSuccess: (draft) => {
      setForm({
        ...form,
        title: draft.title ?? '',
        description: draft.description ?? '',
        category: draft.category ?? '',
        itemName: draft.items?.[0]?.itemName ?? '',
        quantity: String(draft.items?.[0]?.quantity ?? 1),
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: createRfq,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      setOpen(false);
    },
  });

  return (
    <Box>
      <Grid container justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Requests for Quotation</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New RFQ
        </Button>
      </Grid>

      <Box sx={{ height: 600, bgcolor: 'white' }}>
        <DataGrid rows={data ?? []} columns={columns} loading={isLoading} getRowId={(row) => row.id} density="compact" />
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New RFQ</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label="Describe your need (AI draft)"
                fullWidth
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Need 500 cardboard shipping boxes, double-wall, by next month"
              />
              <IconButton color="primary" onClick={() => draftMutation.mutate(aiPrompt)} title="Generate draft with AI">
                <AutoAwesomeIcon />
              </IconButton>
            </Stack>
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <TextField
              label="Description"
              multiline
              minRows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <TextField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <TextField
              label="Due Date"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
            <TextField label="Item Name" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
            <TextField
              label="Quantity"
              type="number"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              createMutation.mutate({
                title: form.title,
                description: form.description,
                category: form.category,
                dueDate: new Date(form.dueDate).toISOString(),
                items: [{ itemName: form.itemName, quantity: Number(form.quantity) }],
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
