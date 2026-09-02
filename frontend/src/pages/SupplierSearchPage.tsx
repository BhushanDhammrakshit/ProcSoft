import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import LanguageIcon from '@mui/icons-material/Language';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AiSupplierSearchResult, DiscoveryJob, SupplierSuggestion, getDiscoveryJob, searchSuppliersWithAi } from '../api/supplierSearch';
import { getSupplier } from '../api/suppliers';

export function SupplierSearchPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiSupplierSearchResult | null>(null);
  const [selected, setSelected] = useState<SupplierSuggestion | null>(null);

  const detailQuery = useQuery({
    queryKey: ['supplier-detail', selected?.supplierId],
    queryFn: () => getSupplier(selected!.supplierId),
    enabled: !!selected,
  });

  const searchMutation = useMutation({
    mutationFn: (p: string) => searchSuppliersWithAi(p),
    onSuccess: (data) => setResult(data),
  });

  const jobId = result?.job?.id;
  const jobRunning = !!result?.job && result.job.status !== 'completed' && result.job.status !== 'failed';

  const jobQuery = useQuery<DiscoveryJob>({
    queryKey: ['discovery-job', jobId],
    queryFn: () => getDiscoveryJob(jobId!),
    enabled: !!jobId && jobRunning,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });

  const job: DiscoveryJob | null = jobQuery.data ?? result?.job ?? null;
  const displayedSuppliers: SupplierSuggestion[] =
    job?.status === 'completed' && job.finalResults?.length ? job.finalResults : result?.suppliers ?? [];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        AI Supplier Search
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="Describe what you need"
              fullWidth
              multiline
              minRows={2}
              placeholder="e.g. Need 2000 corrugated shipping boxes, double-wall, in Pune, budget around ₹1,50,000, delivery within 3 weeks"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              disabled={!prompt.trim() || searchMutation.isPending}
              onClick={() => searchMutation.mutate(prompt)}
              sx={{ whiteSpace: 'nowrap', mt: 1 }}
            >
              Search
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {searchMutation.isPending && (
        <Stack alignItems="center" sx={{ my: 4 }} spacing={1}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            Understanding requirement and searching suppliers...
          </Typography>
        </Stack>
      )}

      {searchMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Search failed. Please try again.
        </Alert>
      )}

      {result && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Extracted Requirement
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {result.criteria.product && <Chip label={`Product: ${result.criteria.product}`} />}
                {result.criteria.quantity && <Chip label={`Quantity: ${result.criteria.quantity}`} />}
                {result.criteria.location && <Chip label={`Location: ${result.criteria.location}`} />}
                {result.criteria.budget && <Chip label={`Budget: ${result.criteria.budget}`} />}
                {result.criteria.specifications && (
                  <Chip label={`Specs: ${result.criteria.specifications}`} />
                )}
              </Stack>
            </CardContent>
          </Card>

          {result.source === 'discovery-pending' && job && (
            <Alert
              severity={job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'info'}
              icon={<TravelExploreIcon />}
              sx={{ mb: 2 }}
            >
              <Box sx={{ mb: 1 }}>{job.progressMessage ?? '🔍 Finding additional suppliers...'}</Box>
              {job.status !== 'completed' && job.status !== 'failed' && <LinearProgress sx={{ mb: 1 }} />}
              {job.queries?.length ? (
                <Box sx={{ mb: 1 }}>
                  <strong>Search queries used:</strong> {job.queries.join(' · ')}
                </Box>
              ) : null}
              {job.status === 'completed' && (
                <Box>
                  Discovered {job.discoveredCount} candidates, {job.qualifiedCount} passed verification and were
                  saved for review (status: pending verification).
                </Box>
              )}
            </Alert>
          )}

          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Ranked Suppliers
          </Typography>
          <Stack spacing={1}>
            {displayedSuppliers.length === 0 && (
              <Typography color="text.secondary">No matching suppliers found.</Typography>
            )}
            {displayedSuppliers.map((s) => (
              <Card key={s.supplierId} variant="outlined">
                <CardActionArea onClick={() => setSelected(s)}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="body1">{s.legalName}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {s.reason}
                        </Typography>
                      </Box>
                      <Chip label={`Score: ${s.score}`} color="primary" />
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {s.email && !s.email.includes('needs-contact') && (
                        <Chip size="small" label={`Email: ${s.email}`} />
                      )}
                      {s.phone && <Chip size="small" label={`Phone: ${s.phone}`} />}
                      {(s.city || s.state) && (
                        <Chip size="small" label={[s.city, s.state].filter(Boolean).join(', ')} />
                      )}
                      {s.verificationStatus && (
                        <Chip
                          size="small"
                          label={s.verificationStatus.replace('_', ' ')}
                          color={s.verificationStatus === 'verified' ? 'success' : 'default'}
                        />
                      )}
                      {s.website && (
                        <Chip size="small" icon={<LanguageIcon />} label="Has website" variant="outlined" />
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        </>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle>{selected?.legalName}</DialogTitle>
        <DialogContent dividers>
          {detailQuery.isLoading && (
            <Stack alignItems="center" sx={{ my: 2 }}>
              <CircularProgress size={24} />
            </Stack>
          )}
          {selected && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2">Match evaluation</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Chip label={`Score: ${selected.score}`} color="primary" />
                  {selected.verificationStatus && (
                    <Chip
                      size="small"
                      label={selected.verificationStatus.replace('_', ' ')}
                      color={selected.verificationStatus === 'verified' ? 'success' : 'default'}
                    />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {selected.reason}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Contact & profile
                </Typography>
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    Email: {detailQuery.data?.email && !detailQuery.data.email.includes('needs-contact')
                      ? detailQuery.data.email
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">Phone: {detailQuery.data?.phone ?? 'Not available'}</Typography>
                  <Typography variant="body2">
                    Location: {[detailQuery.data?.city, detailQuery.data?.state, detailQuery.data?.country]
                      .filter(Boolean)
                      .join(', ') || 'Not available'}
                  </Typography>
                  <Typography variant="body2">
                    Website:{' '}
                    {detailQuery.data?.website ? (
                      <Link href={detailQuery.data.website} target="_blank" rel="noopener noreferrer">
                        {detailQuery.data.website}
                      </Link>
                    ) : (
                      'Not available'
                    )}
                  </Typography>
                  <Typography variant="body2">Tax ID / GSTIN: {detailQuery.data?.taxId ?? 'Not available'}</Typography>
                  <Typography variant="body2">
                    Status: {detailQuery.data?.status} · Source: {detailQuery.data?.source ?? 'unknown'}
                    {detailQuery.data?.sourceTier ? ` (tier ${detailQuery.data.sourceTier})` : ''}
                  </Typography>
                  {typeof detailQuery.data?.discoveryConfidence === 'number' && (
                    <Typography variant="body2">
                      Dedupe confidence: {detailQuery.data.discoveryConfidence}%
                    </Typography>
                  )}
                  <Typography variant="body2">Rating: {detailQuery.data?.rating ?? 0}</Typography>
                  {!!detailQuery.data?.categories?.length && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      {detailQuery.data.categories.map((c) => (
                        <Chip key={c.id} size="small" label={c.name} />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (selected) navigate(`/suppliers?q=${encodeURIComponent(selected.legalName)}`);
              setSelected(null);
            }}
          >
            View in Suppliers
          </Button>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
