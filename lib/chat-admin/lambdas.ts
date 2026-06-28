export interface LambdaFunction {
  id: string
  name: string
  description: string
  category: 'parts'
}

export const AVAILABLE_LAMBDAS: LambdaFunction[] = [
  {
    id: 'partslink',
    name: 'PartsLink',
    description: 'Primary parts search using PartsLink catalog system',
    category: 'parts',
  },
  {
    id: 'psa',
    name: 'PSA (Peugeot & Citroën)',
    description: 'Parts search for PSA Group vehicles (Peugeot, Citroën, Opel, Vauxhall)',
    category: 'parts',
  },
  {
    id: 'vin17',
    name: 'VIN17 (Chinese Brands)',
    description: 'Parts search for Chinese vehicles: MG/SAIC, Xiaopeng, Geely',
    category: 'parts',
  },
  {
    id: 'qipei',
    name: 'Qipei (BYD)',
    description: 'Parts search for BYD electric vehicles',
    category: 'parts',
  },
]

export const getLambdaById = (id: string): LambdaFunction | undefined =>
  AVAILABLE_LAMBDAS.find((lambda) => lambda.id === id)

export const getLambdasByCategory = (
  category: LambdaFunction['category'],
): LambdaFunction[] => AVAILABLE_LAMBDAS.filter((lambda) => lambda.category === category)
