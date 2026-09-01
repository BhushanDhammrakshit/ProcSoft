import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCampaign, listCampaigns, sendCampaign } from '../api/mailing';

const columns: GridColDef[] = [
  { field: 'subject', headerName: 'Subject', flex: 1.2 },
  { field: 'status', headerName: 'Status', flex: 0.5 },
  { field: 'useAiPersonalization', headerName: 'AI Personalized', flex: 0.6, type: 'boolean' },
  {
    field: 'recipients',
    headerName: 'Recipients',
    flex: 0.5,
    valueGetter: (value?: unknown[]) => value?.length ?? 0,
  },
];

export function MailingPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    subject: '',
    bodyTemplate: 'Dear {{contactPerson}},\n\n',
    supplierIds: '',
    useAiPersonalization: false,
  });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: listCampaigns });

  const createMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setOpen(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: sendCampaign,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  return (
    <Box>
      <Grid container justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Bulk Mailing</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New Campaign
        </Button>
      </Grid>

      <Box sx={{ height: 600, bgcolor: 'white' }}>
        <DataGrid
          rows={data ?? []}
          columns={[
            ...columns,
            {
              field: 'actions',
              headerName: '',
              flex: 0.5,
              renderCell: (params) => (
                <Button size="small" onClick={() => sendMutation.mutate(params.row.id)}>
                  Send
                </Button>
              ),
            },
          ]}
          loading={isLoading}
          getRowId={(row) => row.id}
          density="compact"
        />
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Bulk Mail Campaign</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <TextField
              label="Body Template"
              helperText="Use {{legalName}} / {{contactPerson}} placeholders"
              multiline
              minRows={4}
              value={form.bodyTemplate}
              onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
            />
            <TextField
              label="Supplier IDs (comma separated)"
              helperText="Copy IDs from the Suppliers grid"
              value={form.supplierIds}
              onChange={(e) => setForm({ ...form, supplierIds: e.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.useAiPersonalization}
                  onChange={(e) => setForm({ ...form, useAiPersonalization: e.target.checked })}
                />
              }
              label="Use AI to personalize each supplier's email"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() =>
              createMutation.mutate({
                subject: form.subject,
                bodyTemplate: form.bodyTemplate,
                useAiPersonalization: form.useAiPersonalization,
                supplierIds: form.supplierIds
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
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
